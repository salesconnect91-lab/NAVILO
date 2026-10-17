-- Vehicle identity stays in Vehicle Master. All money posts through canonical journals.
begin;
alter table public.transport_vehicle_expense_documents drop constraint transport_vehicle_expense_documents_status_check;
alter table public.transport_vehicle_expense_documents add constraint transport_vehicle_expense_documents_status_check check(status in ('draft','posted','reversed'));
alter table public.transport_vehicle_expense_documents
 add column operating_location_id uuid references public.operating_locations(id),
 add column payment_account_id uuid references public.chart_of_accounts(id),
 add column journal_entry_id uuid unique references public.journal_entries(id),
 add column reversal_entry_id uuid unique references public.journal_entries(id),
 add column updated_at timestamptz not null default now();
alter table public.transport_vehicle_expense_document_lines drop constraint transport_vehicle_expense_document_lines_vat_rate_check;
alter table public.transport_vehicle_expense_document_lines
 add constraint transport_vehicle_expense_line_rate check(vat_rate between 0 and 100),
 add column expense_account_id uuid references public.chart_of_accounts(id),
 add column vat_recoverable boolean not null default true;
create unique index transport_vehicle_expense_group_case_uidx on public.transport_vehicle_expense_documents(company_id,business_unit_id,lower(btrim(expense_group)));

create policy vehicle_expense_read on public.transport_vehicle_expense_documents for select to authenticated
 using(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id()
 and operating_location_id=public.current_operating_location_id() and public.has_module_permission(company_id,'transport','view') and public.has_module_permission(company_id,'accounting','view'));
create policy vehicle_expense_lines_read on public.transport_vehicle_expense_document_lines for select to authenticated
 using(exists(select 1 from public.transport_vehicle_expense_documents d where d.id=document_id));
grant select on public.transport_vehicle_expense_documents,public.transport_vehicle_expense_document_lines to authenticated;

create function public.transport_vehicle_expense_save(p_document jsonb,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
 d uuid;old_status text;r jsonb;ix int:=0;veh uuid;trip uuid;acc uuid;sup uuid;pay uuid;dt date;rate numeric;net numeric;et text;m text;g text;
begin
 perform public.assert_module_permission('transport','edit');perform public.assert_module_permission('accounting','create');
 if auth.uid() is null or c is null or b is null or loc is null or not exists(select 1 from public.business_units where id=b and company_id=c and unit_type='transport' and is_active)
 then raise exception 'Active authenticated Transport company, business unit and location required';end if;
 if not exists(select 1 from public.operating_locations where id=loc and company_id=c and business_unit_id=b and is_active) then raise exception 'Active operating location required';end if;
 if jsonb_typeof(p_document) is distinct from 'object' or jsonb_typeof(p_document->'lines') is distinct from 'array' or jsonb_array_length(p_document->'lines') not between 1 and 500 or octet_length(p_document::text)>500000 then raise exception '1–500 expense lines required';end if;
 dt:=(p_document->>'expense_date')::date;g:=btrim(p_document->>'expense_group');m:=lower(p_document->>'payment_method');
 sup:=nullif(p_document->>'supplier_id','')::uuid;pay:=nullif(p_document->>'payment_account_id','')::uuid;
 if dt is null or g is null or length(g) not between 1 and 80 or m is null or m not in ('cash','bank','payable') then raise exception 'Group, date and valid payment method required';end if;
 if sup is not null and not exists(select 1 from public.suppliers where id=sup and company_id=c and is_active) then raise exception 'Active company supplier required';end if;
 if m='payable' and sup is null then raise exception 'Payable requires Supplier Master';end if;
 if m<>'payable' and pay is not null and not exists(select 1 from public.chart_of_accounts where id=pay and company_id=c and is_active and not is_group and type='asset' and detail_type=case when m='cash' then 'Cash on Hand' else 'Bank Account' end) then raise exception 'Select matching company Cash/Bank account';end if;
 if p_id is null then
  insert into public.transport_vehicle_expense_documents(company_id,business_unit_id,operating_location_id,expense_group,expense_date,supplier_id,payment_method,payment_account_id)
  values(c,b,loc,g,dt,sup,m,pay) returning id into d;
 else
  select id,status into d,old_status from public.transport_vehicle_expense_documents where id=p_id and company_id=c and business_unit_id=b and operating_location_id=loc for update;
  if d is null or old_status<>'draft' then raise exception 'Only a draft in the active workspace can be edited';end if;
  update public.transport_vehicle_expense_documents set expense_group=g,expense_date=dt,supplier_id=sup,payment_method=m,payment_account_id=pay,updated_at=now() where id=d;
  delete from public.transport_vehicle_expense_document_lines where document_id=d;
 end if;
 for r in select value from jsonb_array_elements(p_document->'lines') loop
  ix:=ix+1;veh:=(r->>'vehicle_id')::uuid;trip:=case when r ? 'trip_no' then null else nullif(r->>'trip_id','')::uuid end;acc:=nullif(r->>'expense_account_id','')::uuid;et:=btrim(r->>'expense_type');
  if nullif(btrim(r->>'trip_no'),'') is not null then
   select id into trip from public.transport_trips where company_id=c and business_unit_id=b and operating_location_id=loc and trip_no=btrim(r->>'trip_no');
   if trip is null then raise exception 'Line %: Trip Number not found in active workspace',ix;end if;
  end if;
  if not exists(select 1 from public.transport_vehicles v join public.transport_vehicle_ownership o on o.vehicle_id=v.id and o.company_id=v.company_id and o.business_unit_id=v.business_unit_id where v.id=veh and v.company_id=c and v.business_unit_id=b and v.is_active and o.owner_type='company' and o.effective_from<=dt and (o.effective_to is null or o.effective_to>=dt)) then raise exception 'Line %: vehicle must be company-owned on expense date',ix;end if;
  if trip is not null and not exists(select 1 from public.transport_trips where id=trip and vehicle_id=veh and company_id=c and business_unit_id=b and operating_location_id=loc) then raise exception 'Line %: Trip/vehicle/workspace mismatch',ix;end if;
  if not exists(select 1 from public.transport_vehicle_expense_types where company_id=c and business_unit_id=b and is_active and lower(btrim(name))=lower(et)) then raise exception 'Line %: active expense type required',ix;end if;
  if not exists(select 1 from public.chart_of_accounts where id=acc and company_id=c and type='expense' and is_active and not is_group) then raise exception 'Line %: active company expense account required',ix;end if;
  if coalesce(r->>'net_amount','') !~ '^[0-9]{1,12}([.][0-9]{1,2})?$' or coalesce(r->>'vat_rate','') !~ '^[0-9]{1,3}([.][0-9]{1,2})?$' then raise exception 'Line %: valid net and VAT rate required',ix;end if;
  net:=(r->>'net_amount')::numeric;rate:=(r->>'vat_rate')::numeric;
  if net<=0 or rate<0 or rate>100 then raise exception 'Line %: invalid amount/rate',ix;end if;
  if rate>0 and rate is distinct from public.fixed_tax_rate_on(c,'purchase',dt) then raise exception 'Line %: VAT must match effective purchase rate on expense date',ix;end if;
  insert into public.transport_vehicle_expense_document_lines(company_id,business_unit_id,document_id,line_number,vehicle_id,trip_id,expense_type,description,net_amount,vat_rate,vat_amount,source_reference,expense_account_id,vat_recoverable)
  values(c,b,d,ix,veh,trip,et,btrim(r->>'description'),net,rate,round(net*rate/100,2),btrim(r->>'source_reference'),acc,coalesce((r->>'vat_recoverable')::boolean,true));
 end loop;
 return jsonb_build_object('document_id',d,'status','draft','lines',ix);
end $$;

create function public.transport_vehicle_expense_import(p_documents jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d jsonb;outcome jsonb:='[]';begin
 if jsonb_typeof(p_documents) is distinct from 'array' or jsonb_array_length(p_documents) not between 1 and 50 or octet_length(p_documents::text)>1000000 then raise exception '1–50 expense groups per atomic import';end if;
 for d in select value from jsonb_array_elements(p_documents) loop outcome:=outcome||jsonb_build_array(public.transport_vehicle_expense_save(d));end loop;
 return outcome;
end $$;

-- Keep the previously committed draft RPC compatible with already-open clients.
-- Such drafts now receive branch scope and can be reviewed by the new screen.
create or replace function public.transport_save_vehicle_expense_draft(p_group text,p_date date,p_supplier_id uuid,p_method text,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare expense uuid;lines jsonb;begin
 perform public.assert_module_permission('transport','edit');perform public.assert_module_permission('accounting','create');
 if auth.uid() is null then raise exception 'Authentication required';end if;
 expense:=public.fx_mapping_account(public.legacy_data_user_id(),public.current_company_id(),'cogs','expense');
 select jsonb_agg(value||jsonb_build_object('expense_account_id',coalesce(nullif(value->>'expense_account_id','')::uuid,expense))) into lines from jsonb_array_elements(p_lines);
 return public.transport_vehicle_expense_save(jsonb_build_object('expense_group',p_group,'expense_date',p_date,'supplier_id',p_supplier_id,'payment_method',p_method,'lines',lines));
end $$;

create function public.transport_vehicle_expense_post(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.transport_vehicle_expense_documents%rowtype;r record;j uuid;pay uuid;tax uuid;total numeric:=0;recoverable numeric:=0;party text;u uuid:=public.legacy_data_user_id();
begin
 perform public.assert_module_permission('transport','edit');perform public.assert_module_permission('accounting','post');
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select * into d from public.transport_vehicle_expense_documents where id=p_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and operating_location_id=public.current_operating_location_id() for update;
 if not found then raise exception 'Expense document not found in active workspace';end if;
 if d.status='posted' then return jsonb_build_object('document_id',d.id,'journal_entry_id',d.journal_entry_id,'status','posted','already_posted',true);end if;
 if d.status<>'draft' then raise exception 'Only drafts can post';end if;
 if not exists(select 1 from public.transport_vehicle_expense_document_lines where document_id=d.id) then raise exception 'Expense lines required';end if;
 if d.payment_method='payable' then
  pay:=public.fx_mapping_account(u,d.company_id,'accounts_payable','liability');
  select name into party from public.suppliers where id=d.supplier_id and company_id=d.company_id and is_active and (account_id is null or account_id=pay);
  if party is null then raise exception 'Supplier/AP mapping mismatch';end if;
 else
  pay:=d.payment_account_id;
  if not exists(select 1 from public.chart_of_accounts where id=pay and company_id=d.company_id and is_active and not is_group and type='asset' and detail_type=case when d.payment_method='cash' then 'Cash on Hand' else 'Bank Account' end) then raise exception 'Matching Cash/Bank account required before posting';end if;
 end if;
 insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,trans_type,source_module,source_document_type,source_document_id)
 values(u,d.company_id,d.business_unit_id,d.operating_location_id,'VEXP-'||left(d.expense_group,40)||'-'||left(d.id::text,8),d.expense_date,'Vehicle expense '||d.expense_group,'draft','Manual Journal','accounting','transport_vehicle_expense',d.id) returning id into j;
 for r in select * from public.transport_vehicle_expense_document_lines where document_id=d.id order by line_number loop
  if not exists(select 1 from public.transport_vehicles v join public.transport_vehicle_ownership o on o.vehicle_id=v.id and o.company_id=v.company_id and o.business_unit_id=v.business_unit_id where v.id=r.vehicle_id and v.company_id=d.company_id and v.business_unit_id=d.business_unit_id and v.is_active and o.owner_type='company' and o.effective_from<=d.expense_date and (o.effective_to is null or o.effective_to>=d.expense_date)) then raise exception 'Vehicle must be active and company-owned on expense date';end if;
  if r.vat_rate>0 and r.vat_rate is distinct from public.fixed_tax_rate_on(d.company_id,'purchase',d.expense_date) then raise exception 'Effective VAT changed; review draft before posting';end if;
  if not exists(select 1 from public.transport_vehicle_expense_types where company_id=d.company_id and business_unit_id=d.business_unit_id and is_active and lower(btrim(name))=lower(btrim(r.expense_type))) then raise exception 'Expense type no longer active';end if;
  if r.trip_id is not null and not exists(select 1 from public.transport_trips where id=r.trip_id and vehicle_id=r.vehicle_id and company_id=d.company_id and business_unit_id=d.business_unit_id and operating_location_id=d.operating_location_id) then raise exception 'Trip/vehicle mismatch';end if;
  if not exists(select 1 from public.chart_of_accounts where id=r.expense_account_id and company_id=d.company_id and type='expense' and is_active and not is_group) then raise exception 'Active expense account required';end if;
  insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit,transport_vehicle_id)
  select u,d.company_id,d.business_unit_id,d.operating_location_id,j,a.id,a.code||' - '||a.name,r.net_amount+case when r.vat_recoverable then 0 else r.vat_amount end,0,r.vehicle_id from public.chart_of_accounts a where a.id=r.expense_account_id;
  total:=total+r.net_amount+r.vat_amount;recoverable:=recoverable+case when r.vat_recoverable then r.vat_amount else 0 end;
 end loop;
 if recoverable>0 then
  tax:=public.fx_mapping_account(u,d.company_id,'input_vat','asset');
  insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit)
  select u,d.company_id,d.business_unit_id,d.operating_location_id,j,id,code||' - '||name,recoverable,0 from public.chart_of_accounts where id=tax;
 end if;
 insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit,party_type,party_id,party_name)
 select u,d.company_id,d.business_unit_id,d.operating_location_id,j,id,code||' - '||name,0,total,case when d.payment_method='payable' then 'supplier' end,case when d.payment_method='payable' then d.supplier_id end,party from public.chart_of_accounts where id=pay;
 perform public.post_journal_entry(j);
 update public.transport_vehicle_expense_documents set status='posted',journal_entry_id=j,updated_at=now() where id=d.id;
 return jsonb_build_object('document_id',d.id,'journal_entry_id',j,'status','posted','gross',total,'recoverable_vat',recoverable);
end $$;

create table public.transport_vehicle_expense_reverse_gate(transaction_id bigint not null,document_id uuid not null,primary key(transaction_id,document_id));
alter table public.transport_vehicle_expense_reverse_gate enable row level security;
revoke all on public.transport_vehicle_expense_reverse_gate from public,anon,authenticated;
create function public.guard_vehicle_expense_reversal() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.reversal_of_entry_id is not null and exists(select 1 from public.transport_vehicle_expense_documents d where d.journal_entry_id=new.reversal_of_entry_id and not exists(select 1 from public.transport_vehicle_expense_reverse_gate g where g.document_id=d.id and g.transaction_id=txid_current())) then raise exception 'Use Vehicle Expenses reversal to preserve document and accounting status';end if;
 return new;
end $$;
create trigger zz_vehicle_expense_reversal before insert on public.journal_entries for each row execute function public.guard_vehicle_expense_reversal();
revoke all on function public.guard_vehicle_expense_reversal() from public,anon,authenticated;

create function public.transport_vehicle_expense_reverse(p_id uuid,p_date date,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.transport_vehicle_expense_documents%rowtype;r jsonb;begin
 perform public.assert_module_permission('transport','edit');perform public.assert_module_permission('accounting','post');
 select * into d from public.transport_vehicle_expense_documents where id=p_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and operating_location_id=public.current_operating_location_id() for update;
 if not found or d.status<>'posted' then raise exception 'Posted expense in active workspace required';end if;
 insert into public.transport_vehicle_expense_reverse_gate values(txid_current(),d.id);
 r:=public.reverse_manual_journal_entry(d.journal_entry_id,p_date,p_reason);
 delete from public.transport_vehicle_expense_reverse_gate where transaction_id=txid_current() and document_id=d.id;
 update public.transport_vehicle_expense_documents set status='reversed',reversal_entry_id=(r->>'reversal_entry_id')::uuid,updated_at=now() where id=d.id;
 return r;
end $$;

create function public.guard_vehicle_expense_journal() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid;begin
 if tg_table_name='journal_entries' then target:=old.id;else target:=old.entry_id;end if;
 if exists(select 1 from public.transport_vehicle_expense_documents where journal_entry_id=target and status in ('posted','reversed')) then raise exception 'Posted vehicle expense is immutable; use Expense reversal';end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
create trigger zz_vehicle_expense_journal before update or delete on public.journal_entries for each row execute function public.guard_vehicle_expense_journal();
create trigger zz_vehicle_expense_journal_line before update or delete on public.journal_lines for each row execute function public.guard_vehicle_expense_journal();
revoke all on function public.guard_vehicle_expense_journal() from public,anon,authenticated;

-- A real vehicle FK protects normal invoice allocations when a vehicle has no Trips.
alter table public.sales_service_lines add column transport_vehicle_id uuid,
 add foreign key(company_id,business_unit_id,transport_vehicle_id) references public.transport_vehicles(company_id,business_unit_id,id);
alter table public.purchase_service_lines add column transport_vehicle_id uuid,
 add foreign key(company_id,business_unit_id,transport_vehicle_id) references public.transport_vehicles(company_id,business_unit_id,id);
create index sales_service_normal_vehicle_idx on public.sales_service_lines(company_id,business_unit_id,transport_vehicle_id,order_id) where transport_vehicle_id is not null;
create index purchase_service_normal_vehicle_idx on public.purchase_service_lines(company_id,business_unit_id,transport_vehicle_id,order_id) where transport_vehicle_id is not null;
create index vehicle_expense_document_location_idx on public.transport_vehicle_expense_documents(company_id,business_unit_id,operating_location_id,created_at desc);
-- Sales line allocations use immutable canonical document contributions.
-- NULL vehicle continues to mean General / Shared; no vehicle-specific COA needed.
do $$declare f text;begin
 f:=pg_get_functiondef('public.transport_normal_invoice_create(text,uuid,date,jsonb,uuid,text,text,boolean)'::regprocedure);
 f:=replace(f,'source_module,created_by)','source_module,source_id,created_by)');
 f:=replace(f,'''transport_normal'',auth.uid()',
  'case when nullif(line->>''vehicle_id'','''') is null then ''transport_normal'' else ''transport_normal_vehicle'' end,nullif(line->>''vehicle_id'','''')::uuid,auth.uid()');
 if position('transport_normal_vehicle' in f)=0 then raise exception 'Normal invoice vehicle patch did not match';end if;
 execute f;
end $$;
create function public.guard_normal_invoice_vehicle() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare dt date;begin
 if new.source_module is distinct from 'transport_normal_vehicle' then new.transport_vehicle_id:=null;return new;end if;
 new.transport_vehicle_id:=new.source_id;
 if tg_table_name='sales_service_lines' then select order_date into dt from public.sales_orders where id=new.order_id and company_id=new.company_id and business_unit_id=new.business_unit_id;
 else select order_date into dt from public.purchase_orders where id=new.order_id and company_id=new.company_id and business_unit_id=new.business_unit_id;end if;
 if new.source_id is null or not exists(select 1 from public.transport_vehicles v join public.transport_vehicle_ownership o on o.vehicle_id=v.id and o.company_id=v.company_id and o.business_unit_id=v.business_unit_id where v.id=new.source_id and v.company_id=new.company_id and v.business_unit_id=new.business_unit_id and v.is_active and o.owner_type='company' and o.effective_from<=dt and (o.effective_to is null or o.effective_to>=dt)) then raise exception 'Select a company-owned vehicle valid on invoice date';end if;
 return new;
end $$;
create trigger normal_sales_vehicle before insert or update on public.sales_service_lines for each row execute function public.guard_normal_invoice_vehicle();
create trigger normal_purchase_vehicle before insert or update on public.purchase_service_lines for each row execute function public.guard_normal_invoice_vehicle();

create function public.guard_normal_vehicle_invoice_header() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare ids uuid[];begin
 if old.status<>'draft' then return new;end if;
 if tg_table_name='sales_orders' then select array_agg(source_id) into ids from public.sales_service_lines where order_id=new.id and source_module='transport_normal_vehicle';
 else select array_agg(source_id) into ids from public.purchase_service_lines where order_id=new.id and source_module='transport_normal_vehicle';end if;
 if ids is null then return new;end if;
 if exists(select 1 from unnest(ids) vid where not exists(select 1 from public.transport_vehicle_ownership o join public.transport_vehicles v on v.id=o.vehicle_id and v.company_id=o.company_id and v.business_unit_id=o.business_unit_id where o.vehicle_id=vid and o.company_id=new.company_id and o.business_unit_id=new.business_unit_id and v.is_active and o.owner_type='company' and o.effective_from<=new.order_date and (o.effective_to is null or o.effective_to>=new.order_date))) then raise exception 'Vehicle must be company-owned on invoice date';end if;
 return new;
end $$;
create trigger zzz_normal_vehicle_sales_header before update on public.sales_orders for each row execute function public.guard_normal_vehicle_invoice_header();
create trigger zzz_normal_vehicle_purchase_header before update on public.purchase_orders for each row execute function public.guard_normal_vehicle_invoice_header();
revoke all on function public.guard_normal_vehicle_invoice_header() from public,anon,authenticated;

-- Snapshot line weights at canonical posting. Later reopen/edit operations cannot
-- rewrite a prior period's vehicle allocation or its reversing journal.
create table public.transport_normal_vehicle_allocations(
 journal_entry_id uuid not null references public.journal_entries(id),source_line_id uuid not null,
 company_id uuid not null,business_unit_id uuid not null,operating_location_id uuid not null,
 side text not null check(side in ('customer','supplier')),order_id uuid not null,
 vehicle_id uuid,amount numeric(18,2) not null check(amount>0),
 primary key(journal_entry_id,source_line_id),
 foreign key(company_id,business_unit_id,vehicle_id) references public.transport_vehicles(company_id,business_unit_id,id)
);
alter table public.transport_normal_vehicle_allocations enable row level security;
revoke all on public.transport_normal_vehicle_allocations from public,anon,authenticated;
grant select on public.transport_normal_vehicle_allocations to authenticated;
create policy normal_vehicle_allocation_read on public.transport_normal_vehicle_allocations for select to authenticated using(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and operating_location_id=public.current_operating_location_id() and public.has_module_permission(company_id,'accounting','view') and public.has_module_permission(company_id,'transport','view'));
create index normal_vehicle_allocation_scope_idx on public.transport_normal_vehicle_allocations(company_id,business_unit_id,vehicle_id,order_id);
create index normal_vehicle_allocation_order_idx on public.transport_normal_vehicle_allocations(side,order_id,journal_entry_id);
create function public.snapshot_normal_vehicle_allocations() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.status<>'posted' or old.status='posted' or new.reversal_of_entry_id is not null then return new;end if;
 if new.source_document_type='sales_invoice' and exists(select 1 from public.sales_service_lines where order_id=new.source_document_id and source_module='transport_normal_vehicle') then
  insert into public.transport_normal_vehicle_allocations(journal_entry_id,source_line_id,company_id,business_unit_id,operating_location_id,side,order_id,vehicle_id,amount)
  select new.id,l.id,new.company_id,new.business_unit_id,new.operating_location_id,'customer',l.order_id,case when l.source_module='transport_normal_vehicle' then l.transport_vehicle_id end,l.amount from public.sales_service_lines l where l.order_id=new.source_document_id and l.company_id=new.company_id and l.business_unit_id=new.business_unit_id;
 elsif new.source_document_type='purchase_invoice' and exists(select 1 from public.purchase_service_lines where order_id=new.source_document_id and source_module='transport_normal_vehicle') then
  insert into public.transport_normal_vehicle_allocations(journal_entry_id,source_line_id,company_id,business_unit_id,operating_location_id,side,order_id,vehicle_id,amount)
  select new.id,l.id,new.company_id,new.business_unit_id,new.operating_location_id,'supplier',l.order_id,case when l.source_module='transport_normal_vehicle' then l.transport_vehicle_id end,l.amount from public.purchase_service_lines l where l.order_id=new.source_document_id and l.company_id=new.company_id and l.business_unit_id=new.business_unit_id;
 end if;
 return new;
end $$;
create trigger zzzz_normal_vehicle_snapshot after update of status on public.journal_entries for each row execute function public.snapshot_normal_vehicle_allocations();
revoke all on function public.snapshot_normal_vehicle_allocations() from public,anon,authenticated;

-- Every movement is valued from canonical income/expense journal lines, including
-- notes/reversals. Residual cents go to the last saved allocation, preserving GL totals.
create view public.transport_normal_vehicle_contributions with(security_invoker=true) as
with originals as (
 select distinct a.side,a.company_id,a.business_unit_id,a.order_id,a.journal_entry_id,a.journal_entry_id allocation_entry_id,'bill'::text event_type
 from public.transport_normal_vehicle_allocations a
 union all
 select n.side,n.company_id,n.business_unit_id,n.order_id,r.journal_entry_id,source.journal_entry_id,'credit_note'
 from public.transport_service_note_lines n join public.return_notes r on r.id=n.note_id and r.status='posted'
 join public.journal_entries note_j on note_j.id=r.journal_entry_id
 join lateral(select a.journal_entry_id from public.transport_normal_vehicle_allocations a join public.journal_entries j on j.id=a.journal_entry_id where a.side=n.side and a.order_id=n.order_id and a.company_id=n.company_id and a.business_unit_id=n.business_unit_id and j.created_at<=note_j.created_at order by j.created_at desc,j.id desc limit 1) source on true
), events as (
 select * from originals union all select o.side,o.company_id,o.business_unit_id,o.order_id,j.id,o.allocation_entry_id,'reversal_'||o.event_type from originals o join public.journal_entries j on j.reversal_of_entry_id=o.journal_entry_id and j.company_id=o.company_id and j.business_unit_id=o.business_unit_id
), movements as (
 select e.side,e.company_id,e.business_unit_id,e.order_id,e.allocation_entry_id,j.operating_location_id,j.entry_date event_date,j.entry_no,e.event_type,
 j.id::text event_id,sum(case when e.side='customer' then l.credit-l.debit else l.debit-l.credit end) net_amount
 from events e join public.journal_entries j on j.id=e.journal_entry_id and j.status='posted'
 join public.journal_lines l on l.entry_id=j.id and l.company_id=j.company_id and l.business_unit_id=j.business_unit_id
 join public.chart_of_accounts a on a.id=l.account_id and a.company_id=l.company_id and a.type=case when e.side='customer' then 'revenue' else 'expense' end
 group by e.side,e.company_id,e.business_unit_id,e.order_id,e.allocation_entry_id,j.operating_location_id,j.entry_date,j.entry_no,e.event_type,j.id
), allocated as (
 select m.*,l.source_line_id line_id,l.vehicle_id,
 round(m.net_amount*l.amount/nullif(sum(l.amount) over(partition by m.event_id),0),2) allocation,
 row_number() over(partition by m.event_id order by l.source_line_id) rn,count(*) over(partition by m.event_id) n
 from movements m join public.transport_normal_vehicle_allocations l on l.journal_entry_id=m.allocation_entry_id and l.company_id=m.company_id and l.business_unit_id=m.business_unit_id
), reconciled as (
 select *,allocation+case when rn=n then net_amount-sum(allocation) over(partition by event_id) else 0 end value from allocated
)
select 'normal-vehicle:'||x.event_id||':'||x.line_id::text event_id,x.company_id,x.business_unit_id,x.operating_location_id,
 null::uuid trip_id,''::text trip_no,v.id account_id,v.vehicle_no account_name,x.event_date,x.entry_no,x.event_type,
 case when x.side='customer' then 'Sale Invoice' else 'Purchase Invoice' end category,''::text expense_accounts,
 case when x.side='customer' then x.value else 0::numeric end revenue,
 case when x.side='supplier' then x.value else 0::numeric end cost
from reconciled x join public.transport_vehicles v on v.id=x.vehicle_id and v.company_id=x.company_id and v.business_unit_id=x.business_unit_id;
revoke all on public.transport_normal_vehicle_contributions from public,anon;
grant select on public.transport_normal_vehicle_contributions to authenticated;
do $$declare f text;begin
 f:=rtrim(pg_get_viewdef('public.transport_vehicle_contributions'::regclass,true),E';\n ');
 execute 'create or replace view public.transport_vehicle_contributions with(security_invoker=true) as select * from ('||f||') existing union all select * from public.transport_normal_vehicle_contributions';
end $$;

create function public.transport_vehicle_ledger(p_vehicle uuid,p_from date default null,p_to date default null,p_limit int default 500,p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;begin
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'accounting','view') or not public.has_module_permission(c,'transport','view') or not public.transport_financial_read_allowed('customer') or not public.transport_financial_read_allowed('supplier') then raise exception 'Vehicle accounting view permissions required';end if;
 if not exists(select 1 from public.transport_vehicles where id=p_vehicle and company_id=c and business_unit_id=b) or (p_from is not null and p_to is not null and p_from>p_to) then raise exception 'Valid vehicle/date range required';end if;
 with filtered as materialized(select * from public.transport_vehicle_contributions where company_id=c and business_unit_id=b and operating_location_id=loc and account_id=p_vehicle and (p_from is null or event_date>=p_from) and (p_to is null or event_date<=p_to)), page as (select * from filtered order by event_date,event_id limit greatest(1,least(p_limit,500)) offset greatest(p_offset,0))
 select jsonb_build_object('rows',(select coalesce(jsonb_agg(to_jsonb(page)),'[]') from page),'count',(select count(*) from filtered),'revenue',(select coalesce(sum(revenue),0) from filtered),'cost',(select coalesce(sum(cost),0) from filtered)) into answer;
 return answer;
end $$;
revoke all on function public.transport_vehicle_expense_save(jsonb,uuid),public.transport_vehicle_expense_import(jsonb),public.transport_vehicle_expense_post(uuid),public.transport_vehicle_expense_reverse(uuid,date,text),public.transport_vehicle_ledger(uuid,date,date,integer,integer) from public,anon;
grant execute on function public.transport_vehicle_expense_save(jsonb,uuid),public.transport_vehicle_expense_import(jsonb),public.transport_vehicle_expense_post(uuid),public.transport_vehicle_expense_reverse(uuid,date,text),public.transport_vehicle_ledger(uuid,date,date,integer,integer) to authenticated;
revoke all on function public.guard_normal_invoice_vehicle() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
