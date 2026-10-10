begin;
-- External billing is canonical Sales service billing with vehicle attribution only.
-- No transport_trips, driver salaries, stock movements or duplicate journal are created.
create table public.transport_external_invoice_lines (
 id uuid primary key,company_id uuid not null,business_unit_id uuid not null,operating_location_id uuid not null,
 sales_order_id uuid not null references public.sales_orders(id),sales_line_id uuid not null unique references public.sales_service_lines(id),
 source_company text not null,source_reference text not null,vehicle_id uuid not null references public.transport_vehicles(id),
 vehicle_no text not null,reference_trip_no text,reference_date date,truck_type text,job_no text,driver_name text,owner_name text,from_location text,to_location text,
 unique(company_id,business_unit_id,source_company,source_reference)
);
create table public.transport_external_credit_allocations (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,business_unit_id uuid not null,operating_location_id uuid not null,
 note_id uuid not null references public.return_notes(id),external_line_id uuid not null references public.transport_external_invoice_lines(id),
 net_amount numeric(18,2) not null check(net_amount>0),unique(note_id,external_line_id)
);
create table public.transport_external_note_requests (
 request_id uuid primary key,company_id uuid not null,business_unit_id uuid not null,operating_location_id uuid not null,
 original_order_id uuid not null references public.sales_orders(id),direction text not null check(direction in ('credit','debit')),
 note_id uuid references public.return_notes(id),debit_order_id uuid references public.sales_orders(id),
 reason text not null,request_payload jsonb not null,result jsonb not null,created_by uuid not null,created_at timestamptz not null default now(),
 check((direction='credit' and note_id is not null and debit_order_id is null) or (direction='debit' and note_id is null and debit_order_id is not null))
);
do $$ declare t text;begin
 foreach t in array array['transport_external_invoice_lines','transport_external_credit_allocations','transport_external_note_requests'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy scoped_read on public.%I for select to authenticated using(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and operating_location_id=public.current_operating_location_id() and public.has_module_permission(company_id,''sales'',''view'') and public.has_module_permission(company_id,''transport'',''view''))',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create trigger evidence_immutable before update or delete on public.%I for each row execute function public.transport_financial_append_only()',t);
 end loop;
end $$;

create function public.transport_preview_external_invoices(p_source_company text,p_rows jsonb) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();x jsonb;st text;reason text;cid uuid;vid uuid;dt date;tax numeric;amt numeric;output jsonb:='[]';
begin
 if auth.uid() is null then raise exception 'Sign in required';end if;
 perform public.assert_module_permission('sales','create');
 if c is null or b is null or loc is null or not exists(select 1 from public.business_units where id=b and company_id=c and unit_type='transport' and is_active) then raise exception 'Active Transport workspace and branch required';end if;
 if nullif(btrim(p_source_company),'') is null or p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Source Company and 1 to 500 lines required';end if;
 for x in select value from jsonb_array_elements(p_rows) loop
 st:='New';reason:='';cid:=null;vid:=null;
 begin
 dt:=(x->>'invoice_date')::date;amt:=(x->>'amount')::numeric;tax:=(x->>'tax_percent')::numeric;
 if dt is null or amt is null or amt<=0 or amt<>round(amt,2) or tax is null or tax not between 0 and 100 or nullif(btrim(x->>'source_reference'),'') is null or nullif(btrim(x->>'description'),'') is null or x->>'sale_type' not in ('Cash','Credit') or x->>'sale_type' is null then raise exception 'Date, positive two-decimal Amount, Reference, Description and Cash/Credit required';end if;
 if (x->>'sale_type'='Cash' and tax<>0) or (x->>'sale_type'='Credit' and (tax<=0 or nullif(btrim(x->>'invoice_no'),'') is null)) then raise exception 'Credit requires Invoice No and VAT; Cash requires zero VAT';end if;
 if coalesce((x->>'tax_amount')::numeric,-1)<>round(amt*tax/100,2) or coalesce((x->>'bill_amount')::numeric,-1)<>amt+round(amt*tax/100,2) then raise exception 'Source net, VAT and gross do not reconcile';end if;
 if tax>0 and tax is distinct from public.fixed_tax_rate_on(c,'sales',dt) then raise exception 'Source VAT does not match effective invoice-date VAT rate';end if;
 if (select count(*) from public.customers where company_id=c and is_active and lower(btrim(name))=lower(btrim(x->>'customer')))<>1 then raise exception 'Customer must match exactly one active master';end if;
 select id into cid from public.customers where company_id=c and is_active and lower(btrim(name))=lower(btrim(x->>'customer'));
 if (select count(*) from public.transport_vehicles where company_id=c and business_unit_id=b and is_active and lower(btrim(vehicle_no))=lower(btrim(x->>'vehicle_no')))<>1 then raise exception 'Vehicle must match exactly one active master';end if;
 select id into vid from public.transport_vehicles where company_id=c and business_unit_id=b and is_active and lower(btrim(vehicle_no))=lower(btrim(x->>'vehicle_no'));
 if (select count(*) from jsonb_array_elements(p_rows) y where lower(btrim(y->>'source_reference'))=lower(btrim(x->>'source_reference')))<>1 then raise exception 'Duplicate source reference in file';end if;
 if nullif(btrim(x->>'invoice_no'),'') is not null and exists(select 1 from jsonb_array_elements(p_rows) y where lower(btrim(y->>'invoice_no'))=lower(btrim(x->>'invoice_no')) and (lower(btrim(y->>'customer')) is distinct from lower(btrim(x->>'customer')) or y->>'invoice_date' is distinct from x->>'invoice_date' or y->>'sale_type' is distinct from x->>'sale_type' or (y->>'tax_percent')::numeric is distinct from tax)) then raise exception 'Invoice lines disagree on Customer, Date, Cash/Credit or VAT';end if;
 if exists(select 1 from public.transport_external_invoice_lines e where e.company_id=c and e.business_unit_id=b and e.source_company=lower(btrim(p_source_company)) and e.source_reference=lower(btrim(x->>'source_reference'))) or exists(select 1 from public.transport_owned_vehicle_sales_import_sources e where e.company_id=c and e.business_unit_id=b and lower(btrim(e.source_reference))=lower(btrim(x->>'source_reference'))) or exists(select 1 from public.transport_trips t where t.company_id=c and t.business_unit_id=b and lower(btrim(t.transport_source_company))=lower(btrim(p_source_company)) and lower(btrim(t.transport_source_trip_id))=lower(btrim(x->>'reference_trip_no')) and t.sales_order_id is not null) then st:='Duplicate';reason:='Source line is already billed';
 elsif nullif(btrim(x->>'invoice_no'),'') is not null and exists(select 1 from public.sales_orders where company_id=c and business_unit_id=b and lower(btrim(order_no))=lower(btrim(x->>'invoice_no'))) then st:='Duplicate';reason:='Invoice number already exists';end if;
 exception when others then st:='Error';reason:=sqlerrm;end;
 output:=output||jsonb_build_array(x||jsonb_build_object('import_status',st,'import_reason',reason));
 end loop;
 return jsonb_build_object('rows',output);
end $$;
revoke all on function public.transport_preview_external_invoices(text,jsonb) from public,anon;grant execute on function public.transport_preview_external_invoices(text,jsonb) to authenticated;

create function public.transport_import_external_invoices(p_source_company text,p_revenue_account_id uuid,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();u uuid:=auth.uid();g record;customer record;x jsonb;oid uuid;lid uuid;number text;base text;preview jsonb;invoices int:=0;
begin
 if u is null then raise exception 'Sign in required';end if;
 perform public.assert_module_permission('sales','create');perform public.transport_finance_assert('billing');
 perform pg_advisory_xact_lock(hashtextextended(c::text||b::text||':external-billing',0));
 preview:=public.transport_preview_external_invoices(p_source_company,p_rows);
 if exists(select 1 from jsonb_array_elements(preview->'rows') x where x->>'import_status'<>'New') then raise exception 'Import blocked: duplicate or invalid lines. Review the preview';end if;
 if not exists(select 1 from public.chart_of_accounts where id=p_revenue_account_id and company_id=c and type='revenue' and is_active and not is_group) then raise exception 'Active same-company revenue account required';end if;
 select base_currency_code into base from public.companies where id=c;
 for g in select coalesce(nullif(lower(btrim(x->>'invoice_no')),''),'cash:'||lower(btrim(x->>'source_reference'))) group_key,min(btrim(x->>'invoice_no')) invoice_no,min((x->>'invoice_date')::date) invoice_date,min(x->>'sale_type') sale_type,min(x->>'customer') customer_name,min((x->>'tax_percent')::numeric) tax,jsonb_agg(x) rows from jsonb_array_elements(p_rows) x group by 1 loop
 select * into customer from public.customers where company_id=c and is_active and lower(btrim(name))=lower(btrim(g.customer_name));
 number:=public.transport_choose_invoice_number('customer',nullif(g.invoice_no,''));
 insert into public.sales_orders(user_id,company_id,business_unit_id,operating_location_id,order_no,customer_id,order_date,status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,payment_mode,created_by,transport_source_company,transport_source_invoice_id)
 values(customer.user_id,c,b,loc,number,customer.id,g.invoice_date,'draft',case when g.sale_type='Credit' then 'Tax Invoice' else 'Sale Invoice' end,g.tax,base,1,'service',g.sale_type,u,lower(btrim(p_source_company)),g.group_key) returning id into oid;
 for x in select value from jsonb_array_elements(g.rows) loop
 lid:=gen_random_uuid();
 insert into public.sales_service_lines(id,company_id,business_unit_id,order_id,description,amount,tax_percent,revenue_account_id,source_module,source_id,created_by)
 values(lid,c,b,oid,btrim(x->>'description'),(x->>'amount')::numeric,g.tax,p_revenue_account_id,'external_transport',lid,u);
 insert into public.transport_external_invoice_lines(id,company_id,business_unit_id,operating_location_id,sales_order_id,sales_line_id,source_company,source_reference,vehicle_id,vehicle_no,reference_trip_no,reference_date,truck_type,job_no,driver_name,owner_name,from_location,to_location)
 select lid,c,b,loc,oid,lid,lower(btrim(p_source_company)),lower(btrim(x->>'source_reference')),v.id,v.vehicle_no,x->>'reference_trip_no',nullif(x->>'reference_date','')::date,x->>'truck_type',x->>'job_no',x->>'driver_name',x->>'owner_name',x->>'from_location',x->>'to_location' from public.transport_vehicles v where v.company_id=c and v.business_unit_id=b and v.is_active and lower(btrim(v.vehicle_no))=lower(btrim(x->>'vehicle_no'));
 end loop;
 invoices:=invoices+1;
 end loop;
 return jsonb_build_object('invoices',invoices,'lines',jsonb_array_length(p_rows),'status','draft');
end $$;
revoke all on function public.transport_import_external_invoices(text,uuid,jsonb) from public,anon;grant execute on function public.transport_import_external_invoices(text,uuid,jsonb) to authenticated;

create function public.transport_link_external_sales_on_post() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
declare j uuid;
begin
 if not exists(select 1 from public.transport_external_invoice_lines where sales_order_id=new.id) then return new;end if;
 select id into j from public.journal_entries where company_id=new.company_id and business_unit_id=new.business_unit_id and operating_location_id=new.operating_location_id and source_document_id=new.id and status='posted' order by created_at desc limit 1;
 if j is null then raise exception 'Canonical posted Sales journal required';end if;
 insert into public.transport_customer_documents(company_id,business_unit_id,operating_location_id,customer_id,sales_order_id,paid_amount,created_by,document_kind,journal_entry_id)
 values(new.company_id,new.business_unit_id,new.operating_location_id,new.customer_id,new.id,0,coalesce(new.posted_by,new.created_by),case when new.payment_mode='Cash' then 'cash_hand_bill' else 'credit' end,j);
 return new;
end $$;
revoke all on function public.transport_link_external_sales_on_post() from public,anon,authenticated;
create trigger zzzz_link_external_sales_on_post after update of status on public.sales_orders for each row when(new.status='posted' and old.status is distinct from new.status) execute function public.transport_link_external_sales_on_post();

-- Amount corrections allocate to original vehicle lines; the canonical journal is posted once.
create function public.transport_post_external_invoice_note(p_request_id uuid,p_order_id uuid,p_direction text,p_date date,p_reason text,p_lines jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();u uuid:=auth.uid();o public.sales_orders%rowtype;x jsonb;l record;amount numeric;used numeric;net numeric:=0;payload jsonb;prior record;result jsonb;oid uuid;lid uuid;number text;
begin
 if u is null then raise exception 'Sign in required';end if;
 perform public.transport_finance_assert('adjustment');perform public.assert_module_permission('sales','post');
 if p_request_id is null or p_direction not in ('credit','debit') or p_direction is null or p_date is null or nullif(btrim(p_reason),'') is null or p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 500 then raise exception 'Request, Credit/Debit, Date, Reason and 1 to 500 lines required';end if;
 payload:=jsonb_build_object('order',p_order_id,'direction',p_direction,'date',p_date,'reason',btrim(p_reason),'lines',p_lines);
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into prior from public.transport_external_note_requests where request_id=p_request_id;
 if found then if prior.company_id<>c or prior.business_unit_id<>b or prior.operating_location_id<>loc or prior.request_payload<>payload then raise exception 'Request identity conflict';end if;return prior.result;end if;
 select * into o from public.sales_orders where id=p_order_id and company_id=c and business_unit_id=b and operating_location_id=loc for update;
 if not found or o.status<>'posted' or not exists(select 1 from public.transport_external_invoice_lines where sales_order_id=o.id) or not exists(select 1 from public.transport_customer_documents d join public.transport_active_journals j on j.id=d.journal_entry_id where d.sales_order_id=o.id) then raise exception 'Posted unreversed external invoice in active branch required';end if;
 if p_date<o.order_date then raise exception 'Note date cannot precede original invoice date';end if;
 if exists(select 1 from jsonb_array_elements(p_lines) x group by x->>'line_id' having count(*)>1) then raise exception 'Duplicate note line';end if;
 for x in select value from jsonb_array_elements(p_lines) loop
 select e.*,s.amount,s.tax_percent,s.description,s.revenue_account_id into l from public.transport_external_invoice_lines e join public.sales_service_lines s on s.id=e.sales_line_id where e.id=(x->>'line_id')::uuid and e.sales_order_id=o.id;
 if not found then raise exception 'Original same-invoice vehicle line required';end if;
 amount:=(x->>'amount')::numeric;if amount is null or amount<=0 or amount<>round(amount,2) then raise exception 'Positive two-decimal note amount required';end if;
 if p_direction='credit' then
 select coalesce(sum(a.net_amount),0) into used from public.transport_external_credit_allocations a join public.return_notes r on r.id=a.note_id join public.transport_active_journals j on j.id=r.journal_entry_id where a.external_line_id=l.id;
 if amount>l.amount-used then raise exception 'Credit exceeds remaining value for Vehicle %',l.vehicle_no;end if;
 end if;net:=net+amount;
 end loop;
 if p_direction='credit' then
 result:=public.transport_post_service_note('customer',o.id,net,p_date,btrim(p_reason));
 insert into public.transport_external_credit_allocations(company_id,business_unit_id,operating_location_id,note_id,external_line_id,net_amount)
 select c,b,loc,(result->>'note_id')::uuid,(x->>'line_id')::uuid,(x->>'amount')::numeric from jsonb_array_elements(p_lines) x;
 else
 perform public.assert_module_permission('sales','create');
 number:='DN-'||substr(replace(p_request_id::text,'-',''),1,16);
 insert into public.sales_orders(user_id,company_id,business_unit_id,operating_location_id,order_no,customer_id,order_date,status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,payment_mode,created_by,transport_source_company,transport_source_invoice_id)
 values(o.user_id,c,b,loc,number,o.customer_id,p_date,'draft',o.invoice_type,o.tax_percent,o.currency_code,1,'service',o.payment_mode,u,o.transport_source_company,'debit:'||p_request_id::text) returning id into oid;
 for x in select value from jsonb_array_elements(p_lines) loop
 select e.*,s.description,s.revenue_account_id into l from public.transport_external_invoice_lines e join public.sales_service_lines s on s.id=e.sales_line_id where e.id=(x->>'line_id')::uuid;
 lid:=gen_random_uuid();
 insert into public.sales_service_lines(id,company_id,business_unit_id,order_id,description,amount,tax_percent,revenue_account_id,source_module,source_id,created_by) values(lid,c,b,oid,'Debit note for '||o.order_no||': '||btrim(p_reason)||' · '||l.description,(x->>'amount')::numeric,o.tax_percent,l.revenue_account_id,'external_transport',lid,u);
 insert into public.transport_external_invoice_lines(id,company_id,business_unit_id,operating_location_id,sales_order_id,sales_line_id,source_company,source_reference,vehicle_id,vehicle_no,reference_trip_no,reference_date,truck_type,job_no,driver_name,owner_name,from_location,to_location)
 values(lid,c,b,loc,oid,lid,l.source_company,'debit:'||p_request_id::text||':'||l.id::text,l.vehicle_id,l.vehicle_no,l.reference_trip_no,l.reference_date,l.truck_type,l.job_no,l.driver_name,l.owner_name,l.from_location,l.to_location);
 end loop;
 result:=public.post_sales_invoice(oid);result:=result||jsonb_build_object('debit_order_id',oid,'note_no',number,'net',net,'vat',round(net*o.tax_percent/100,2));
 end if;
 insert into public.transport_external_note_requests(request_id,company_id,business_unit_id,operating_location_id,original_order_id,direction,note_id,debit_order_id,reason,request_payload,result,created_by)
 values(p_request_id,c,b,loc,o.id,p_direction,case when p_direction='credit' then (result->>'note_id')::uuid end,oid,btrim(p_reason),payload,result,u);
 return result;
end $$;
revoke all on function public.transport_post_external_invoice_note(uuid,uuid,text,date,text,jsonb) from public,anon;grant execute on function public.transport_post_external_invoice_note(uuid,uuid,text,date,text,jsonb) to authenticated;

create view public.transport_external_invoice_register with(security_invoker=true) as
select e.*,s.order_no,s.order_date,s.payment_mode,s.status,c.name customer_name,l.description,l.amount original_net,l.tax_percent,
 coalesce(a.net,0) credited_net,l.amount-coalesce(a.net,0) current_net,n.original_order_id,
 case when n.debit_order_id is not null then 'Sales Debit Note' when s.payment_mode='Cash' then 'Cash Bill' else 'VAT Invoice' end billing_kind
from public.transport_external_invoice_lines e
join public.sales_orders s on s.id=e.sales_order_id
join public.sales_service_lines l on l.id=e.sales_line_id
join public.customers c on c.id=s.customer_id
left join public.transport_external_note_requests n on n.debit_order_id=s.id
left join lateral(select sum(a.net_amount) net from public.transport_external_credit_allocations a join public.return_notes r on r.id=a.note_id join public.transport_active_journals j on j.id=r.journal_entry_id where a.external_line_id=e.id) a on true;
revoke all on public.transport_external_invoice_register from public,anon;grant select on public.transport_external_invoice_register to authenticated;

-- Add no-trip invoices to the existing customer statements, allocations and reports.
-- Preserve every existing source query and its permissions.
do $$ declare definition text;begin
 select regexp_replace(pg_get_viewdef('public.transport_party_document_sources'::regclass,true),';\s*$','') into definition;
 execute 'create or replace view public.transport_party_document_sources with(security_invoker=true) as select * from ('||definition||') existing union all
 select ''customer''::text,s.id,s.company_id,s.business_unit_id,s.operating_location_id,s.customer_id,
 coalesce(s.customer_name_snapshot,c.name,s.customer_id::text),s.order_no,s.order_date,s.total,
 coalesce((select sum(amount) from public.sales_service_lines where order_id=s.id),0),d.journal_entry_id,d.document_kind::text,
 array[]::uuid[],coalesce((select string_agg(distinct reference_trip_no,'', '') from public.transport_external_invoice_lines where sales_order_id=s.id),''''),j.entry_no,j.entry_date
 from public.sales_orders s join public.transport_customer_documents d on d.sales_order_id=s.id
 join public.journal_entries j on j.id=d.journal_entry_id and j.status=''posted''
 left join public.customers c on c.id=s.customer_id
 where exists(select 1 from public.transport_external_invoice_lines where sales_order_id=s.id)
 and s.company_id=public.current_company_id() and s.business_unit_id=public.current_business_unit_id()
 and s.operating_location_id=public.current_operating_location_id() and public.has_module_permission(s.company_id,''transport'',''view'')';
end $$;

create view public.transport_external_vehicle_contributions with(security_invoker=true) as
with entries as (
 select e.id,e.company_id,e.business_unit_id,e.operating_location_id,e.vehicle_id,e.vehicle_no,e.reference_trip_no,j.id journal_id,j.entry_date,j.entry_no,
 case when n.debit_order_id is not null then 'debit_note' else 'bill' end event_type,l.amount revenue
 from public.transport_external_invoice_lines e join public.sales_service_lines l on l.id=e.sales_line_id
 join public.transport_customer_documents d on d.sales_order_id=e.sales_order_id
 join public.journal_entries j on j.id=d.journal_entry_id and j.status='posted'
 left join public.transport_external_note_requests n on n.debit_order_id=e.sales_order_id
 union all
 select e.id,e.company_id,e.business_unit_id,e.operating_location_id,e.vehicle_id,e.vehicle_no,e.reference_trip_no,j.id,j.entry_date,j.entry_no,'credit_note',-a.net_amount
 from public.transport_external_credit_allocations a join public.transport_external_invoice_lines e on e.id=a.external_line_id
 join public.return_notes n on n.id=a.note_id and n.status='posted' join public.journal_entries j on j.id=n.journal_entry_id and j.status='posted'
), events as (
 select * from entries
 union all
 select e.id,e.company_id,e.business_unit_id,e.operating_location_id,e.vehicle_id,e.vehicle_no,e.reference_trip_no,r.id,r.entry_date,r.entry_no,'reversal_'||e.event_type,-e.revenue
 from entries e join public.journal_entries r on r.reversal_of_entry_id=e.journal_id and r.status='posted'
)
select ('external:'||journal_id::text||':'||id::text) event_id,company_id,business_unit_id,operating_location_id,
 null::uuid trip_id,reference_trip_no trip_no,vehicle_id account_id,vehicle_no account_name,entry_date event_date,entry_no,event_type,
 'Revenue'::text category,''::text expense_accounts,revenue,0::numeric cost from events;
revoke all on public.transport_external_vehicle_contributions from public,anon;grant select on public.transport_external_vehicle_contributions to authenticated;
do $$ declare definition text;begin
 select regexp_replace(pg_get_viewdef('public.transport_vehicle_contributions'::regclass,true),';\s*$','') into definition;
 execute 'create or replace view public.transport_vehicle_contributions with(security_invoker=true) as select * from ('||definition||') existing union all select * from public.transport_external_vehicle_contributions';
end $$;
commit;
