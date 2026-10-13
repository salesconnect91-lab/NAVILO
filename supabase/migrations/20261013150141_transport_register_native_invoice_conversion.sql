-- Controlled conversion of immutable opening evidence into canonical service invoices.
-- Source records and the original opening journal are never edited/deleted.
-- Historical clearing uses equity, never a fabricated cash/bank movement.
begin;
create table public.transport_register_conversion_sources(
 company_id uuid not null,business_unit_id uuid not null,operating_location_id uuid not null,
 source_hash text not null,reference text not null,customer_key text not null,
 invoice_date date not null,net numeric not null,gross numeric not null,source_row integer,
 created_by uuid not null,created_at timestamptz not null default now(),
 primary key(company_id,business_unit_id,operating_location_id,reference,customer_key),
 check(net>0 and gross>=net));
create table public.transport_register_conversion_dates(
 company_id uuid not null,business_unit_id uuid not null,operating_location_id uuid not null,
 reference text not null,invoice_date date not null,created_by uuid not null,
 primary key(company_id,business_unit_id,operating_location_id,reference));
create table public.transport_register_invoice_conversions(
 document_id uuid primary key references public.transport_opening_invoice_documents(id),
 company_id uuid not null,business_unit_id uuid not null,operating_location_id uuid not null,side text not null,
 order_id uuid unique,invoice_date date not null,date_basis text not null,number text,
 net numeric(18,2) not null,gross numeric(18,2) not null,vat numeric(18,2) not null,
 historical_settled numeric(18,2) not null,retained_credit numeric(18,2) not null default 0,
 amount_basis text not null,status text not null check(status in('prepared','posted','blocked','zero_value')),
 invoice_journal_id uuid,clearing_journal_id uuid,reclass_journal_id uuid,error text,
 approved_reason text not null,created_by uuid not null,created_at timestamptz not null default now(),posted_at timestamptz);
create index transport_register_conversion_scope on public.transport_register_invoice_conversions(company_id,business_unit_id,operating_location_id,side,status);
create table public.transport_register_invoice_conversion_lines(
 document_id uuid not null references public.transport_register_invoice_conversions(document_id),
 trip_id uuid not null references public.transport_trips(id),net numeric(18,2) not null,vat numeric(18,2) not null,
 gross numeric(18,2) not null,tax_percent numeric(7,4) not null,
 primary key(document_id,trip_id),check(net>=0 and vat>=0 and gross=net+vat));
create table public.transport_register_conversion_gates(
 transaction_id bigint not null,order_id uuid not null,document_id uuid not null,side text not null,actor_id uuid not null,
 primary key(transaction_id,order_id));
alter table public.sales_orders add column transport_register_conversion_id uuid references public.transport_opening_invoice_documents(id);
alter table public.purchase_orders add column transport_register_conversion_id uuid references public.transport_opening_invoice_documents(id);
alter table public.sales_orders add column transport_conversion_error text;
alter table public.purchase_orders add column transport_conversion_error text;
alter table public.sales_service_lines add column historical_vat_amount numeric(18,2);
alter table public.purchase_service_lines add column historical_vat_amount numeric(18,2);
do $$ declare t text;begin
 foreach t in array array['transport_register_conversion_sources','transport_register_conversion_dates','transport_register_invoice_conversions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy %I on public.%I for select to authenticated using(company_id=(select public.current_company_id()) and business_unit_id=(select public.current_business_unit_id()) and operating_location_id=(select public.current_operating_location_id()) and public.has_module_permission(company_id,''accounting'',''view''))',t||'_read',t);
 end loop;
end $$;
drop policy transport_register_invoice_conversions_read on public.transport_register_invoice_conversions;
create policy transport_register_invoice_conversions_read on public.transport_register_invoice_conversions for select to authenticated using(
 company_id=(select public.current_company_id()) and business_unit_id=(select public.current_business_unit_id()) and operating_location_id=(select public.current_operating_location_id())
 and public.transport_financial_read_allowed(side));
alter table public.transport_register_invoice_conversion_lines enable row level security;
alter table public.transport_register_conversion_gates enable row level security;
revoke all on public.transport_register_invoice_conversion_lines,public.transport_register_conversion_gates from public,anon,authenticated;
grant select on public.transport_register_invoice_conversion_lines to authenticated;
create policy conversion_lines_read on public.transport_register_invoice_conversion_lines for select to authenticated using(exists(select 1 from public.transport_register_invoice_conversions c where c.document_id=transport_register_invoice_conversion_lines.document_id));

create function public.transport_register_conversion_allowed(p_order uuid,p_side text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select auth.uid() is not null and exists(select 1 from public.transport_register_conversion_gates g
 join public.transport_register_invoice_conversions v on v.document_id=g.document_id
 where g.transaction_id=txid_current() and g.actor_id=auth.uid() and g.order_id=p_order and g.side=p_side
 and v.order_id=p_order and v.side=p_side and v.company_id=public.current_company_id()
 and v.business_unit_id=public.current_business_unit_id() and v.operating_location_id=public.current_operating_location_id()
 and v.status in('prepared','blocked') and public.has_module_permission(v.company_id,case when p_side='customer' then 'sales' else 'purchase' end,'post'));
$$;
revoke all on function public.transport_register_conversion_allowed(uuid,text) from public,anon,authenticated;
create function public.transport_guard_register_conversion_identity() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.transport_conversion_error is not null and (tg_op='INSERT' or new.transport_conversion_error is distinct from old.transport_conversion_error)
 and not public.transport_register_conversion_allowed(new.id,case when tg_table_name='sales_orders' then 'customer' else 'supplier' end)
 then raise exception 'Conversion error must come from controlled import';end if;
 if new.transport_register_conversion_id is not null and (tg_op='INSERT' or new.transport_register_conversion_id is distinct from old.transport_register_conversion_id)
 and not public.transport_register_conversion_allowed(new.id,case when tg_table_name='sales_orders' then 'customer' else 'supplier' end)
 then raise exception 'Historical conversion identity requires controlled import';end if;return new;
end $$;
revoke all on function public.transport_guard_register_conversion_identity() from public,anon,authenticated;
create trigger aaa_register_conversion_identity before insert or update on public.sales_orders for each row execute function public.transport_guard_register_conversion_identity();
create trigger aaa_register_conversion_identity before insert or update on public.purchase_orders for each row execute function public.transport_guard_register_conversion_identity();

create function public.transport_prepare_register_invoice_conversion(p_source_hash text,p_invoices jsonb,p_dates jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
 d record;s record;v record;x record;day date;basis text;net numeric;gross numeric;paid numeric;rate numeric;weight numeric;total_weight numeric;target_net numeric;target_gross numeric;used_net numeric;used_gross numeric;n int;idx int;last_id uuid;cnt int:=0;
begin
 perform public.transport_history_import_assert();perform public.assert_module_permission('accounting','post');
 if p_source_hash !~ '^[a-f0-9]{64}$' or length(trim(coalesce(p_reason,'')))<20 or jsonb_typeof(p_invoices) is distinct from 'array' or jsonb_typeof(p_dates) is distinct from 'array' or jsonb_array_length(p_invoices)>5000 or jsonb_array_length(p_dates)>5000 then raise exception 'Source identity, approved reason and invoice/date arrays required';end if;
 perform pg_advisory_xact_lock(hashtextextended('register-conversion:'||c||':'||b||':'||loc,0));
 if exists(select 1 from public.transport_opening_invoice_allocations a join public.transport_opening_invoice_documents d on d.id=a.document_id where d.company_id=c and d.business_unit_id=b and d.operating_location_id=loc) then raise exception 'Existing opening settlements must be explicitly migrated before conversion';end if;
 for x in select * from jsonb_to_recordset(p_dates) as q(reference text,date date) loop
  if x.date is null or x.date>current_date or nullif(trim(x.reference),'') is null then raise exception 'Valid approved source invoice date required';end if;
  insert into public.transport_register_conversion_dates values(c,b,loc,trim(x.reference),x.date,auth.uid()) on conflict do nothing;
  if exists(select 1 from public.transport_register_conversion_dates where company_id=c and business_unit_id=b and operating_location_id=loc and reference=trim(x.reference) and invoice_date<>x.date) then raise exception 'Invoice date changed on retry';end if;
 end loop;
 for x in select * from jsonb_to_recordset(p_invoices) as q(reference text,customer text,date date,net numeric,gross numeric,"row" integer) loop
  if x.date is null or x.date>current_date or x.net<=0 or x.gross<x.net or nullif(trim(x.reference),'') is null or nullif(trim(x.customer),'') is null then raise exception 'Invalid source invoice row %',x.row;end if;
  insert into public.transport_register_conversion_sources values(c,b,loc,p_source_hash,trim(x.reference),lower(trim(x.customer)),x.date,x.net,x.gross,x.row,auth.uid()) on conflict do nothing;
  if exists(select 1 from public.transport_register_conversion_sources where company_id=c and business_unit_id=b and operating_location_id=loc and reference=trim(x.reference) and customer_key=lower(trim(x.customer)) and (source_hash,net,gross,invoice_date) is distinct from(p_source_hash,x.net,x.gross,x.date)) then raise exception 'Source invoice changed on retry';end if;
 end loop;
 for d in select q.* from public.transport_opening_invoice_documents q join public.transport_active_journals j on j.id=q.journal_entry_id where q.company_id=c and q.business_unit_id=b and q.operating_location_id=loc and not exists(select 1 from public.transport_register_invoice_conversions v where v.document_id=q.id) order by q.id loop
  select * into s from public.transport_register_conversion_sources where company_id=c and business_unit_id=b and operating_location_id=loc and d.side='customer' and reference=d.original_reference and customer_key=lower(trim(d.party_name));
  select invoice_date into day from public.transport_register_conversion_dates where company_id=c and business_unit_id=b and operating_location_id=loc and reference=d.original_reference;
  basis:='Supplied invoice creation date';if day is null then select max(t.trip_date) into day from public.transport_opening_invoice_lines l join public.transport_trips t on t.id=l.trip_id where l.document_id=d.id;basis:='Latest linked Trip date, explicitly authorized';end if;
  if day is null or day>current_date then raise exception 'Invalid posting date for source document %',d.id;end if;
  if s.reference is not null then net:=round(s.net,2);gross:=round(s.gross,2);basis:=basis;else
   select coalesce(sum(case when l.original_net>0 and least(abs(l.original_gross-l.original_net),abs(l.original_gross-l.original_net*1.15))<=.02 then round(l.original_net,2)
    else round(l.original_gross/(1+case when d.side='customer' then case when coalesce(nullif(m.raw_source->>21,''),'0')::numeric>0 then .15 else 0 end else case when m.raw_source->>16 like '%(15.00%)%' then .15 else 0 end end),2) end),0),round(sum(l.original_gross),2)
    into net,gross from public.transport_opening_invoice_lines l join public.transport_historical_operational_mapping m on m.trip_id=l.trip_id where l.document_id=d.id;
   if gross>0 then gross:=greatest(gross,case when d.historical_settled<0 and abs(d.historical_settled)<=.10 then d.opening_remaining else gross end);end if;
  end if;
  paid:=greatest(round(d.historical_settled,2),0);
  if d.side='customer' then paid:=least(paid,gross);end if;
  insert into public.transport_register_invoice_conversions(document_id,company_id,business_unit_id,operating_location_id,side,order_id,invoice_date,date_basis,net,gross,vat,historical_settled,retained_credit,amount_basis,status,approved_reason,created_by)
  values(d.id,c,b,loc,d.side,case when gross>0 then gen_random_uuid() end,day,basis,net,gross,greatest(gross-net,0),least(paid,gross),case when d.side='supplier' then greatest(-d.opening_remaining,0) else 0 end,
  case when s.reference is not null then 'Supplied invoice workbook, exact customer + reference match; Trip attribution allocated by source weights' else 'Register gross and VAT evidence; invalid net derived at source VAT rate; raw evidence retained' end,
  case when gross>0 and net>0 and gross>=net then 'prepared' when gross=0 then 'zero_value' else 'blocked' end,p_reason,auth.uid());
  if gross<=0 or net<=0 or gross<net then continue;end if;
  select count(*) into n from public.transport_opening_invoice_lines where document_id=d.id;
  used_net:=0;used_gross:=0;idx:=0;
  select sum(greatest(l.original_net,l.original_gross,1)) into total_weight from public.transport_opening_invoice_lines l where l.document_id=d.id;
  for v in select l.*,m.raw_source from public.transport_opening_invoice_lines l join public.transport_historical_operational_mapping m on m.trip_id=l.trip_id where l.document_id=d.id order by l.trip_id loop
   idx:=idx+1;weight:=greatest(v.original_net,v.original_gross,1);
   if s.reference is not null then
    target_net:=case when idx=n then net-used_net else round(net*weight/total_weight,2) end;
    target_gross:=case when idx=n then gross-used_gross else round(gross*weight/total_weight,2) end;
    rate:=case when gross>net then 15 else 0 end;
   else
    rate:=case when d.side='customer' then case when coalesce(nullif(v.raw_source->>21,''),'0')::numeric>0 then 15 else 0 end else case when v.raw_source->>16 like '%(15.00%)%' then 15 else 0 end end;
    target_net:=case when v.original_net>0 and least(abs(v.original_gross-v.original_net),abs(v.original_gross-v.original_net*1.15))<=.02 then round(v.original_net,2) else round(v.original_gross/(1+rate/100),2) end;
    target_gross:=case when idx=n then gross-used_gross else round(v.original_gross,2) end;
    if idx=n then target_net:=net-used_net;end if;
   end if;
   if target_net<0 or target_gross<target_net then raise exception 'Source invoice allocation cannot reconcile without negative VAT: %/%',d.id,v.trip_id;end if;
   insert into public.transport_register_invoice_conversion_lines values(d.id,v.trip_id,target_net,target_gross-target_net,target_gross,rate);
   used_net:=used_net+target_net;used_gross:=used_gross+target_gross;
  end loop;
  cnt:=cnt+1;
 end loop;
 return jsonb_build_object('prepared',cnt,'summary',(select jsonb_agg(x) from(select side,status,count(*) documents,sum(gross) gross,sum(gross-historical_settled-retained_credit) expected_signed_balance from public.transport_register_invoice_conversions where company_id=c and business_unit_id=b and operating_location_id=loc group by side,status)x));
end $$;
revoke all on function public.transport_prepare_register_invoice_conversion(text,jsonb,jsonb,text) from public,anon;
grant execute on function public.transport_prepare_register_invoice_conversion(text,jsonb,jsonb,text) to authenticated;

-- Only the approved, scoped, transaction-local conversion may retain historical
-- billing snapshots instead of applying today's party billing mode to old records.
-- The ordinary Tax Invoice posting/STRN guard is intentionally retained.
do $patch$ declare f text;n text;gate text;begin
 foreach n in array array['transport_order_billing_guard','transport_guard_sales_customer_billing_mode','transport_sync_draft_billing','enforce_document_tax_rate','standardize_invoice_classification','guard_document_tax_transition'] loop
  f:=pg_get_functiondef(to_regprocedure('public.'||n||'()'));
  gate:=E'\n if public.transport_register_conversion_allowed(new.id,case when tg_table_name=''sales_orders'' then ''customer'' else ''supplier'' end) then return new;end if;\n';
  -- Older production schemas do not have this optional transition trigger.
  -- Keep it protected when present; all required billing guards remain mandatory.
  if f is null and n='guard_document_tax_transition' then continue;end if;
  if f is null then raise exception 'Missing conversion guard %',n;end if;
  f:=regexp_replace(f,'\mbegin\M','begin'||gate,'i');execute f;
 end loop;
 foreach n in array array['transport_line_billing_guard','guard_service_document_line'] loop
  f:=pg_get_functiondef(to_regprocedure('public.'||n||'()'));
  gate:=E'\n if tg_op<>''DELETE'' and public.transport_register_conversion_allowed(new.order_id,case when tg_table_name=''sales_service_lines'' then ''customer'' else ''supplier'' end) then\n'
   ||E' if new.source_module<>''historical_register'' or not exists(select 1 from public.transport_register_invoice_conversion_lines l join public.transport_register_invoice_conversions v on v.document_id=l.document_id where v.order_id=new.order_id and l.trip_id=new.source_id and l.net=new.amount and l.vat=new.historical_vat_amount and l.tax_percent=new.tax_percent) then raise exception ''Historical service line must exactly match approved source allocation'';end if;return new;end if;\n'
   ||E' if tg_table_name in(''sales_service_lines'',''purchase_service_lines'') then if tg_op<>''DELETE'' and new.historical_vat_amount is not null then raise exception ''Historical VAT snapshot requires controlled conversion'';end if;end if;\n';
  f:=regexp_replace(f,'\mbegin\M','begin'||gate,'i');execute f;
 end loop;
 -- Preserve every normal canonical posting check; the approved per-line VAT
 -- snapshot accounts for rounding without altering the original source evidence.
 foreach n in array array['post_service_sales_invoice_core','post_service_purchase_invoice_core'] loop
  f:=pg_get_functiondef(to_regprocedure('public.'||n||'(uuid)'));
  if position('sum(round(amount*tax_percent/100,2))' in replace(f,' ',''))=0 then raise exception 'Unexpected service VAT posting body %',n;end if;
  f:=regexp_replace(f,'sum\(round\(amount\s*\*\s*tax_percent\s*/\s*100\s*,\s*2\)\)','sum(coalesce(historical_vat_amount,round(amount*tax_percent/100,2)))');execute f;
 end loop;
 f:=pg_get_functiondef('public.transport_opening_no_rebill()'::regprocedure);
 gate:=E'\n if exists(select 1 from public.transport_register_invoice_conversion_lines l join public.transport_register_invoice_conversions v on v.document_id=l.document_id where l.trip_id=new.trip_id and v.side=case when tg_table_name=''transport_customer_document_trips'' then ''customer'' else ''supplier'' end and public.transport_register_conversion_allowed(v.order_id,v.side) and ((v.side=''customer'' and exists(select 1 from public.transport_customer_documents d where d.id=new.document_id and d.sales_order_id=v.order_id)) or(v.side=''supplier'' and exists(select 1 from public.transport_supplier_documents d where d.id=new.document_id and d.purchase_order_id=v.order_id)))) then return new;end if;\n';
 f:=regexp_replace(f,'\mbegin\M','begin'||gate,'i');execute f;
end $patch$;

create function public.transport_convert_register_invoice_batch(p_side text,p_limit integer default 50,p_retry_blocked boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp set plan_cache_mode=force_custom_plan as $$
#variable_conflict use_variable
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();u uuid:=public.legacy_data_user_id();
 v record;d record;l record;base text;mode text;number text;tax numeric;doc uuid;rent uuid;bill jsonb;j uuid;line_id uuid;
 equity uuid;party_account uuid;cost uuid;amount numeric;signed_amount numeric;done int:=0;blocked int:=0;created int:=0;why text;
begin
 perform public.transport_history_import_assert();perform public.assert_module_permission('accounting','post');
 perform public.assert_module_permission(case when p_side='customer' then 'sales' else 'purchase' end,'create');
 perform public.assert_module_permission(case when p_side='customer' then 'sales' else 'purchase' end,'post');
 if p_side not in('customer','supplier') or p_limit not between 1 and 100 then raise exception 'Valid invoice side and batch of 1-100 required';end if;
 select base_currency_code into base from public.companies where id=c;
 select (array_agg(distinct a.id))[1] into equity from public.transport_opening_invoice_documents z
 join public.journal_lines jl on jl.entry_id=z.journal_entry_id and jl.party_id is null
 join public.chart_of_accounts a on a.id=jl.account_id and a.company_id=c and a.type='equity' and not a.is_group and a.is_active
 where z.company_id=c and z.business_unit_id=b and z.operating_location_id=loc having count(distinct a.id)=1;
 select account_id into cost from public.account_mappings where company_id=c and mapping_key='transport_expense';
 if equity is null or cost is null then raise exception 'Opening equity and Transport expense mappings required';end if;
 party_account:=public.fx_mapping_account(u,c,case when p_side='customer' then 'accounts_receivable' else 'accounts_payable' end,case when p_side='customer' then 'asset' else 'liability' end);
 for v in select q.* from public.transport_register_invoice_conversions q where q.company_id=c and q.business_unit_id=b and q.operating_location_id=loc and q.side=p_side and (q.status='prepared' or p_retry_blocked and q.status='blocked') order by q.document_id limit p_limit for update skip locked loop
  select * into strict d from public.transport_opening_invoice_documents where id=v.document_id;
  if not exists(select 1 from public.transport_active_journals where id=d.journal_entry_id) then raise exception 'Active original opening journal required';end if;
  insert into public.transport_register_conversion_gates values(txid_current(),v.order_id,v.document_id,p_side,auth.uid());
  tax:=case when v.vat>0 then 15 else 0 end;mode:=case when tax>0 then 'Credit' else 'Cash' end;
  if v.number is null then
   number:=case when p_side='customer' then coalesce(nullif(trim(d.original_reference),''),'H-S-'||substr(replace(v.document_id::text,'-',''),1,20)) else 'H-P-'||substr(replace(v.document_id::text,'-',''),1,20) end;
   if p_side='customer' and exists(select 1 from public.sales_orders where company_id=c and lower(trim(order_no))=lower(number)) then number:='H-S-'||substr(replace(v.document_id::text,'-',''),1,20);end if;
   number:=public.transport_choose_invoice_number(p_side,number);
   update public.transport_register_invoice_conversions set number=number where document_id=v.document_id;
   if p_side='customer' then
    insert into public.sales_orders(id,user_id,company_id,business_unit_id,operating_location_id,order_no,customer_id,order_date,status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,payment_mode,created_by,transport_register_conversion_id,transport_source_company,transport_source_invoice_id)
    values(v.order_id,u,c,b,loc,number,d.party_id,v.invoice_date,'draft',case when tax>0 then 'Tax Invoice' else 'Sale Invoice' end,tax,base,1,'service',mode,auth.uid(),v.document_id,'Historical Register',v.document_id::text);
   else
    insert into public.purchase_orders(id,user_id,company_id,business_unit_id,operating_location_id,order_no,supplier_id,order_date,status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,transport_billing_mode,supplier_invoice_no,supplier_invoice_date,created_by,transport_register_conversion_id)
    values(v.order_id,u,c,b,loc,number,d.party_id,v.invoice_date,'draft',case when tax>0 then 'Tax Invoice' else 'Purchase Invoice' end,tax,base,1,'service',mode,coalesce(nullif(trim(d.original_reference),''),'Historical Register '||substr(v.document_id::text,1,8)),v.invoice_date,auth.uid(),v.document_id);
   end if;
   for l in select x.*,public.transport_display_trip_no(t.id,t.trip_no) trip_no from public.transport_register_invoice_conversion_lines x join public.transport_trips t on t.id=x.trip_id where x.document_id=v.document_id and x.net>0 loop
    if p_side='customer' then
     insert into public.sales_service_lines(company_id,business_unit_id,order_id,description,amount,tax_percent,historical_vat_amount,source_module,source_id)
     values(c,b,v.order_id,'Historical Trip '||l.trip_no||coalesce(' · Source invoice '||d.original_reference,''),l.net,l.tax_percent,l.vat,'historical_register',l.trip_id);
    else
     insert into public.purchase_service_lines(company_id,business_unit_id,order_id,description,amount,tax_percent,historical_vat_amount,cost_account_id,source_module,source_id)
     values(c,b,v.order_id,'Historical supplier rent · Trip '||l.trip_no,l.net,l.tax_percent,l.vat,cost,'historical_register',l.trip_id);
    end if;
   end loop;
   if p_side='customer' then update public.sales_orders set total=v.gross where id=v.order_id;else update public.purchase_orders set total=v.gross where id=v.order_id;end if;
   created:=created+1;
  end if;
  -- A failed canonical post rolls its journal/ledger writes back together. The
  -- genuine draft remains visible with the precise prerequisite error.
  if p_side='customer' then update public.sales_orders set transport_conversion_error=null where id=v.order_id;else update public.purchase_orders set transport_conversion_error=null where id=v.order_id;end if;
  begin
   if p_side='customer' then bill:=public.post_sales_invoice(v.order_id);else bill:=public.post_purchase_invoice(v.order_id);end if;
  exception when others then
   get stacked diagnostics why=message_text;
   update public.transport_register_invoice_conversions set status='blocked',error=why where document_id=v.document_id;
   if p_side='customer' then update public.sales_orders set transport_conversion_error=why where id=v.order_id;else update public.purchase_orders set transport_conversion_error=why where id=v.order_id;end if;
   delete from public.transport_register_conversion_gates where transaction_id=txid_current() and order_id=v.order_id;
   blocked:=blocked+1;continue;
  end;
  if (bill->>'grand_total')::numeric<>v.gross then raise exception 'Canonical invoice total differs from approved source';end if;
  if p_side='customer' then
   insert into public.transport_customer_documents(company_id,business_unit_id,operating_location_id,customer_id,sales_order_id,document_kind,journal_entry_id,created_by)
   values(c,b,loc,d.party_id,v.order_id,case when mode='Cash' then 'cash_hand_bill' else 'credit' end,(bill->>'journal_entry_id')::uuid,auth.uid()) returning id into doc;
   insert into public.transport_customer_document_trips(company_id,business_unit_id,operating_location_id,document_id,trip_id,rate_snapshot,vat_snapshot)
   select c,b,loc,doc,trip_id,net,vat from public.transport_register_invoice_conversion_lines where document_id=v.document_id and net>0;
  else
   insert into public.transport_supplier_documents(company_id,business_unit_id,operating_location_id,supplier_id,purchase_order_id,journal_entry_id,created_by)
   values(c,b,loc,d.party_id,v.order_id,(bill->>'journal_entry_id')::uuid,auth.uid()) returning id into doc;
   for l in select * from public.transport_register_invoice_conversion_lines where document_id=v.document_id and net>0 loop
    select id into rent from public.transport_trip_supplier_rents where trip_id=l.trip_id and supplier_id=d.party_id order by created_at limit 1;
    if rent is null then
     if not exists(select 1 from public.transport_opening_invoice_lines ol join public.transport_historical_operational_mapping m on m.trip_id=ol.trip_id where ol.document_id=v.document_id and ol.trip_id=l.trip_id and ol.original_gross>0 and not m.company_owned) then raise exception 'Source supplier rent missing without reconstruction evidence for Trip %',l.trip_id;end if;
     insert into public.transport_trip_supplier_rents(company_id,business_unit_id,operating_location_id,trip_id,supplier_id,supplier_name_snapshot,amount,base_amount,state,reason,created_by)
     values(c,b,loc,l.trip_id,d.party_id,d.party_name,l.net,l.net,'pending','Controlled historical reconstruction from source gross/VAT; original zero net retained',auth.uid()) returning id into rent;
     insert into public.transport_action_gate values(txid_current(),l.trip_id,'supplier_rent_finalize');
     update public.transport_trip_supplier_rents set state='finalized',finalized_amount_snapshot=amount,finalized_base_amount_snapshot=base_amount,finalized_by=auth.uid(),finalized_at=now(),source='spot' where id=rent;
     delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=l.trip_id and action='supplier_rent_finalize';
    end if;
    insert into public.transport_supplier_document_rents(company_id,business_unit_id,operating_location_id,document_id,rent_id,trip_id,amount_snapshot,vat_snapshot)
    values(c,b,loc,doc,rent,l.trip_id,l.net,l.vat);
   end loop;
  end if;
  j:=null;
  if v.historical_settled>0 then
   insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,trans_type,source_module,source_document_type,source_document_id)
   values(u,c,b,loc,'HC-'||substr(replace(v.document_id::text,'-',''),1,24),greatest(d.opening_date,v.invoice_date),'Historical settled balance transfer; no new cash or bank movement','draft','General','transport','transport_historical_clearing',v.order_id) returning id into j;
   insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit,party_type,party_id,party_name)
   select u,c,b,loc,j,id,code||' - '||name,case when p_side='supplier' then v.historical_settled else 0 end,case when p_side='customer' then v.historical_settled else 0 end,p_side,d.party_id,d.party_name from public.chart_of_accounts where id=party_account returning id into line_id;
   insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit)
   select u,c,b,loc,j,id,code||' - '||name,case when p_side='customer' then v.historical_settled else 0 end,case when p_side='supplier' then v.historical_settled else 0 end from public.chart_of_accounts where id=equity;
   perform public.post_journal_entry(j);
   if p_side='customer' then insert into public.invoice_payment_allocations(user_id,company_id,business_unit_id,operating_location_id,sales_order_id,journal_entry_id,journal_line_id,customer_id,allocation_date,amount,reference,notes)
    values(u,c,b,loc,v.order_id,j,line_id,d.party_id,greatest(d.opening_date,v.invoice_date),v.historical_settled,'Historical opening conversion','Existing settled amount; not a new receipt');
   else insert into public.purchase_payment_allocations(user_id,company_id,business_unit_id,operating_location_id,purchase_order_id,order_no,journal_entry_id,journal_line_id,supplier_id,allocation_date,amount,reference,notes)
    values(u,c,b,loc,v.order_id,coalesce(v.number,number),j,line_id,d.party_id,greatest(d.opening_date,v.invoice_date),v.historical_settled,'Historical opening conversion','Existing settled amount; not a new supplier payment');end if;
  end if;
  update public.transport_register_invoice_conversions set clearing_journal_id=j where document_id=v.document_id;
  j:=null;amount:=greatest(d.opening_remaining,0);
  if amount>0 then
   insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,trans_type,source_module,source_document_type,source_document_id)
   values(u,c,b,loc,'HR-'||substr(replace(v.document_id::text,'-',''),1,24),d.opening_date,'Transfer imported opening balance to native invoice; original evidence retained','draft','General','transport','transport_opening_invoice_reclassification',v.document_id) returning id into j;
   insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit,party_type,party_id,party_name)
   select u,c,b,loc,j,id,code||' - '||name,case when p_side='supplier' then amount else 0 end,case when p_side='customer' then amount else 0 end,p_side,d.party_id,d.party_name from public.chart_of_accounts where id=party_account;
   insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit)
   select u,c,b,loc,j,id,code||' - '||name,case when p_side='customer' then amount else 0 end,case when p_side='supplier' then amount else 0 end from public.chart_of_accounts where id=equity;
   perform public.post_journal_entry(j);
  end if;
  if p_side='customer' then perform set_config('app.customer_payment_update','1',true);update public.sales_orders set paid_amount=paid_amount where id=v.order_id;
  else perform set_config('app.supplier_payment_update','1',true);update public.purchase_orders set paid_amount=paid_amount where id=v.order_id;end if;
  update public.transport_register_invoice_conversions set status='posted',error=null,invoice_journal_id=(bill->>'journal_entry_id')::uuid,reclass_journal_id=j,posted_at=now() where document_id=v.document_id;
  delete from public.transport_register_conversion_gates where transaction_id=txid_current() and order_id=v.order_id;
  done:=done+1;
 end loop;
 return jsonb_build_object('posted',done,'blocked',blocked,'drafts_created',created,'remaining',(select count(*) from public.transport_register_invoice_conversions where company_id=c and business_unit_id=b and operating_location_id=loc and side=p_side and status='prepared'));
end $$;
revoke all on function public.transport_convert_register_invoice_batch(text,integer,boolean) from public,anon;
grant execute on function public.transport_convert_register_invoice_batch(text,integer,boolean) to authenticated;

-- Converted invoices must not remain payable a second time through the opening
-- invoice picker. Genuine source supplier credits remain distinct carry-forwards.
do $$ declare f text;begin
 f:=pg_get_viewdef('public.transport_opening_invoice_balances'::regclass,true);
 f:=regexp_replace(f,'d\.original_gross AS current_billed_gross','CASE WHEN cv.status=''posted'' THEN 0::numeric ELSE d.original_gross END AS current_billed_gross');
 f:=regexp_replace(f,'\(d\.historical_settled \+ COALESCE\(p\.amount, \(0\)::numeric\)\) AS current_paid_gross','CASE WHEN cv.status=''posted'' THEN 0::numeric ELSE d.historical_settled + COALESCE(p.amount,0) END AS current_paid_gross');
 f:=regexp_replace(f,';\s*$','');
 f:=f||' ';f:=replace(f,'LEFT JOIN paid p ON p.document_id = d.id','LEFT JOIN paid p ON p.document_id = d.id LEFT JOIN public.transport_register_invoice_conversions cv ON cv.document_id=d.id');
 if position('JOIN public.transport_register_invoice_conversions' in f)=0 then raise exception 'Unexpected opening balance view join';end if;
 execute 'create or replace view public.transport_opening_invoice_balances with(security_invoker=true) as '||f||' WHERE cv.status IS DISTINCT FROM ''posted'' OR d.opening_remaining<0';
end $$;
notify pgrst,'reload schema';
commit;
