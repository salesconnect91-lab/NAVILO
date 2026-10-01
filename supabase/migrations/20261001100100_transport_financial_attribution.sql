begin;
-- User-specific financial actions augment existing Transport/accounting permissions.
create table public.transport_financial_permissions(
 company_id uuid not null references public.companies(id) on delete restrict,
 business_unit_id uuid not null references public.business_units(id) on delete restrict,
 user_id uuid not null references auth.users(id) on delete restrict,
 action text not null check(action in ('billing','rent','settlement','driver','cost','adjustment','close')),
 allowed boolean not null,updated_by uuid not null,updated_at timestamptz not null default now(),
 primary key(company_id,business_unit_id,user_id,action));
alter table public.transport_financial_permissions enable row level security;
create policy transport_financial_permissions_read on public.transport_financial_permissions for select to authenticated
 using(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and (user_id=auth.uid() or (public.has_module_permission(company_id,'settings','view') and exists(select 1 from public.business_unit_memberships m where m.company_id=public.transport_financial_permissions.company_id and m.business_unit_id=public.transport_financial_permissions.business_unit_id and m.user_id=auth.uid() and m.is_active and m.role in ('company_owner','admin')))));
grant select on public.transport_financial_permissions to authenticated;
create function public.transport_finance_allowed(p_action text) returns boolean
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();v boolean;r text;
begin
 if auth.uid() is null or c is null or b is null or not public.has_module_permission(c,'transport','post') then return false; end if;
 select allowed into v from public.transport_financial_permissions where company_id=c and business_unit_id=b and user_id=auth.uid() and action=p_action;
 if found then return v; end if;
 select role into r from public.business_unit_memberships where company_id=c and business_unit_id=b and user_id=auth.uid() and is_active;
 return coalesce(r in ('company_owner','admin'),false);
end $$;
create function public.transport_finance_assert(p_action text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.transport_finance_allowed(p_action) then raise exception 'Transport % permission required',p_action; end if;
 if public.current_operating_location_id() is null then raise exception 'Active operating location required'; end if;
 perform public.assert_module_permission('accounting','post');
end $$;
revoke all on function public.transport_finance_assert(text) from public,anon,authenticated;
revoke all on function public.transport_finance_allowed(text) from public,anon;
grant execute on function public.transport_finance_allowed(text) to authenticated;
create function public.transport_set_financial_permission(p_user_id uuid,p_action text,p_allowed boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();
begin
 if auth.uid() is null or not exists(select 1 from public.business_unit_memberships where company_id=c and business_unit_id=b
 and user_id=auth.uid() and role in ('company_owner','admin') and is_active) or not public.has_module_permission(c,'settings','edit')
 then raise exception 'Workspace administrator required'; end if;
 if not exists(select 1 from public.business_unit_memberships where company_id=c and business_unit_id=b and user_id=p_user_id and is_active)
 then raise exception 'Active workspace member required'; end if;
 insert into public.transport_financial_permissions values(c,b,p_user_id,p_action,p_allowed,auth.uid(),now())
 on conflict(company_id,business_unit_id,user_id,action) do update set allowed=excluded.allowed,updated_by=auth.uid(),updated_at=now();
 insert into public.audit_logs(user_id,module,action,table_name,record_id,performed_by,new_data)
 values(public.legacy_data_user_id(),'transport','financial_permission','transport_financial_permissions',p_user_id,auth.uid(),
 jsonb_build_object('business_unit_id',b,'action',p_action,'allowed',p_allowed));
end $$;
revoke all on function public.transport_set_financial_permission(uuid,text,boolean) from public,anon;
grant execute on function public.transport_set_financial_permission(uuid,text,boolean) to authenticated;

create table public.transport_trip_supplier_rents(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,business_unit_id uuid not null,
 trip_id uuid not null references public.transport_trips(id) on delete restrict,
 supplier_id uuid not null references public.suppliers(id) on delete restrict,
 amount numeric(18,2) not null check(amount>0),reason text not null check(btrim(reason)<>''),
 created_by uuid not null,created_at timestamptz not null default now());
create table public.transport_customer_documents(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,business_unit_id uuid not null,operating_location_id uuid not null,
 customer_id uuid not null references public.customers(id) on delete restrict,
 document_kind text not null check(document_kind in ('credit','cash_hand_bill','adjustment')),
 sales_order_id uuid not null unique references public.sales_orders(id) on delete restrict,
 journal_entry_id uuid not null references public.journal_entries(id) on delete restrict,
 created_by uuid not null,created_at timestamptz not null default now());
create table public.transport_customer_document_trips(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,business_unit_id uuid not null,
 document_id uuid not null references public.transport_customer_documents(id) on delete restrict,
 trip_id uuid not null references public.transport_trips(id) on delete restrict,
 rate_snapshot numeric(18,2) not null check(rate_snapshot>0),vat_snapshot numeric(18,2) not null check(vat_snapshot>=0),
 is_adjustment boolean not null default false,unique(document_id,trip_id));
create unique index transport_original_customer_trip_uq on public.transport_customer_document_trips(trip_id) where not is_adjustment;
create table public.transport_supplier_documents(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,business_unit_id uuid not null,operating_location_id uuid not null,
 supplier_id uuid not null references public.suppliers(id) on delete restrict,
 purchase_order_id uuid not null unique references public.purchase_orders(id) on delete restrict,
 journal_entry_id uuid not null references public.journal_entries(id) on delete restrict,
 created_by uuid not null,created_at timestamptz not null default now());
create table public.transport_supplier_document_rents(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,business_unit_id uuid not null,
 document_id uuid not null references public.transport_supplier_documents(id) on delete restrict,
 rent_id uuid not null references public.transport_trip_supplier_rents(id) on delete restrict,
 trip_id uuid not null references public.transport_trips(id) on delete restrict,
 amount_snapshot numeric(18,2) not null check(amount_snapshot>0),vat_snapshot numeric(18,2) not null check(vat_snapshot>=0),
 is_adjustment boolean not null default false,unique(document_id,rent_id));
create unique index transport_original_supplier_rent_uq on public.transport_supplier_document_rents(rent_id) where not is_adjustment;
create table public.transport_driver_accrual_attributions(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,business_unit_id uuid not null,
 trip_id uuid not null references public.transport_trips(id) on delete restrict,
 accrual_id uuid not null references public.employee_salary_accruals(id) on delete restrict,
 amount numeric(18,2) not null check(amount>0),created_by uuid not null,created_at timestamptz not null default now());
create table public.transport_driver_payment_attributions(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,business_unit_id uuid not null,
 trip_id uuid not null references public.transport_trips(id) on delete restrict,
 salary_payment_id uuid not null references public.employee_salary_payments(id) on delete restrict,
 amount numeric(18,2) not null check(amount>0),created_by uuid not null,created_at timestamptz not null default now());
create table public.transport_service_cost_links(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,business_unit_id uuid not null,
 trip_id uuid not null references public.transport_trips(id) on delete restrict,
 cost_kind text not null check(cost_kind in ('commission','vehicle_expense','other','driver_expense')),
 purchase_order_id uuid not null unique references public.purchase_orders(id) on delete restrict,
 journal_entry_id uuid not null references public.journal_entries(id) on delete restrict,
 amount_snapshot numeric(18,2) not null check(amount_snapshot>0),vat_snapshot numeric(18,2) not null check(vat_snapshot>=0),
 required_for_closure boolean not null default true,created_by uuid not null,created_at timestamptz not null default now());

-- No client can insert an attribution by presenting an arbitrary journal UUID.
-- These tables are append-only and writable exclusively by checked RPCs.
create function public.transport_financial_append_only() returns trigger
language plpgsql as $$begin raise exception 'Transport financial evidence is immutable'; end $$;
revoke all on function public.transport_financial_append_only() from public,anon,authenticated;
do $$ declare t text;begin
 foreach t in array array['transport_trip_supplier_rents','transport_customer_documents','transport_customer_document_trips',
 'transport_supplier_documents','transport_supplier_document_rents','transport_driver_accrual_attributions','transport_driver_payment_attributions','transport_service_cost_links'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy %I on public.%I for select to authenticated using(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,''transport'',''view''))',t||'_read',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create trigger evidence_immutable before update or delete on public.%I for each row execute function public.transport_financial_append_only()',t);
 execute format('create index %I on public.%I(company_id,business_unit_id)',t||'_scope_idx',t);
 end loop;
end $$;

create function public.transport_financial_trip(p_trip_id uuid) returns public.transport_trips
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype;
begin
 select * into t from public.transport_trips where id=p_trip_id and company_id=public.current_company_id()
 and business_unit_id=public.current_business_unit_id() for update;
 if not found or t.status='cancelled' then raise exception 'Active Transport Trip in current workspace required'; end if;
 return t;
end $$;
revoke all on function public.transport_financial_trip(uuid) from public,anon,authenticated;
create function public.transport_financial_audit(p_trip_id uuid,p_event text,p_data jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype;
begin
 t:=public.transport_financial_trip(p_trip_id);
 insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,event_type,new_data,changed_by)
 values(t.company_id,t.business_unit_id,t.id,p_event,p_data,auth.uid());
end $$;
revoke all on function public.transport_financial_audit(uuid,text,jsonb) from public,anon,authenticated;
create function public.transport_add_supplier_rent(p_trip_id uuid,p_supplier_id uuid,p_amount numeric,p_reason text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype;r uuid;
begin
 perform public.transport_finance_assert('rent');t:=public.transport_financial_trip(p_trip_id);
 if not exists(select 1 from public.suppliers where id=p_supplier_id and company_id=t.company_id and is_active)
 then raise exception 'Active same-company supplier required'; end if;
 insert into public.transport_trip_supplier_rents(company_id,business_unit_id,trip_id,supplier_id,amount,reason,created_by)
 values(t.company_id,t.business_unit_id,t.id,p_supplier_id,round(p_amount,2),btrim(p_reason),auth.uid()) returning id into r;
 perform public.transport_financial_audit(t.id,'rent_finalized',jsonb_build_object('rent_id',r,'supplier_id',p_supplier_id,'amount',p_amount,'reason',p_reason));
 return r;
end $$;
revoke all on function public.transport_add_supplier_rent(uuid,uuid,numeric,text) from public,anon;
grant execute on function public.transport_add_supplier_rent(uuid,uuid,numeric,text) to authenticated;

-- Internal factory creates real service Sales/Purchase documents, then calls
-- the canonical public posting dispatcher. It never writes ledgers itself.
create function public.transport_create_service_document(p_side text,p_party uuid,p_date date,p_amount numeric,
 p_tax boolean,p_cost_account uuid,p_description text,p_reference text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
 u uuid:=public.legacy_data_user_id();base text;tax numeric;oid uuid;j jsonb;
begin
 if p_side not in ('customer','supplier') or p_date is null or coalesce(p_amount,0)<=0 then raise exception 'Valid service document required'; end if;
 perform public.assert_module_permission(case when p_side='customer' then 'sales' else 'purchase' end,'create');
 select base_currency_code into base from public.companies where id=c;
 tax:=case when p_tax then public.fixed_tax_rate_on(c,case when p_side='customer' then 'sales' else 'purchase' end,p_date) else 0 end;
 if tax is null then raise exception 'Effective fixed VAT rate required'; end if;
 if p_side='customer' then
 insert into public.sales_orders(user_id,company_id,business_unit_id,operating_location_id,order_no,customer_id,
 order_date,status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,payment_mode)
 values(u,c,b,loc,public.next_document_number('sales','TR-S'),p_party,p_date,'draft',case when p_tax then 'Tax Invoice' else 'Sale Invoice' end,tax,base,1,'service','Credit') returning id into oid;
 insert into public.sales_service_lines(company_id,business_unit_id,order_id,description,amount,tax_percent)
 values(c,b,oid,p_description,round(p_amount,2),tax);
 j:=public.post_sales_invoice(oid);
 else
 insert into public.purchase_orders(user_id,company_id,business_unit_id,operating_location_id,order_no,supplier_id,
 order_date,status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,supplier_invoice_no,supplier_invoice_date)
 values(u,c,b,loc,public.next_document_number('purchase','TR-P'),p_party,p_date,'draft',case when p_tax then 'Tax Invoice' else 'Purchase Invoice' end,tax,base,1,'service',coalesce(nullif(btrim(p_reference),''),'TR-'||substr(gen_random_uuid()::text,1,12)),p_date) returning id into oid;
 insert into public.purchase_service_lines(company_id,business_unit_id,order_id,description,amount,tax_percent,cost_account_id)
 values(c,b,oid,p_description,round(p_amount,2),tax,p_cost_account);
 j:=public.post_purchase_invoice(oid);
 end if;
 return j||jsonb_build_object('document_id',oid,'net',round(p_amount,2),'vat',round(p_amount*tax/100,2),'tax_percent',tax);
end $$;
revoke all on function public.transport_create_service_document(text,uuid,date,numeric,boolean,uuid,text,text) from public,anon,authenticated;

-- One Trip per bill preserves exact allocation attribution. Many Trips for a
-- customer are settled together by canonical multi-invoice receipt allocations.
create function public.transport_post_customer_bill(p_trip_id uuid,p_date date,p_with_tax boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype;r jsonb;d uuid;
begin
 perform public.transport_finance_assert('billing');t:=public.transport_financial_trip(p_trip_id);
 if t.sales_order_id is not null then raise exception 'Trip already references a canonical Sales document; reconcile its existing posted linkage before billing';end if;
 if t.sale_type is null or t.customer_id is null or t.customer_rate<=0
 or exists(select 1 from public.transport_customer_document_trips where trip_id=t.id and not is_adjustment)
 then raise exception 'Unbilled Trip, Cash/Credit classification, customer and positive finalized rate required'; end if;
 r:=public.transport_create_service_document('customer',t.customer_id,p_date,t.customer_rate,p_with_tax,null,
 case when t.sale_type='cash' then 'Transport Cash Hand Bill ' else 'Transport Credit Invoice ' end||t.trip_no);
 insert into public.transport_customer_documents(company_id,business_unit_id,operating_location_id,customer_id,document_kind,sales_order_id,journal_entry_id,created_by)
 values(t.company_id,t.business_unit_id,public.current_operating_location_id(),t.customer_id,
 case when t.sale_type='cash' then 'cash_hand_bill' else 'credit' end,(r->>'document_id')::uuid,(r->>'journal_entry_id')::uuid,auth.uid()) returning id into d;
 insert into public.transport_customer_document_trips(company_id,business_unit_id,document_id,trip_id,rate_snapshot,vat_snapshot)
 values(t.company_id,t.business_unit_id,d,t.id,t.customer_rate,(r->>'vat')::numeric);
 perform public.transport_financial_audit(t.id,'customer_bill_posted',r||jsonb_build_object('transport_document_id',d,'sale_type',t.sale_type));
 return r||jsonb_build_object('transport_document_id',d);
end $$;
revoke all on function public.transport_post_customer_bill(uuid,date,boolean) from public,anon;
grant execute on function public.transport_post_customer_bill(uuid,date,boolean) to authenticated;
create function public.transport_post_supplier_bill(p_rent_id uuid,p_date date,p_cost_account_id uuid,p_with_tax boolean default false,p_reference text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare x public.transport_trip_supplier_rents%rowtype;t public.transport_trips%rowtype;r jsonb;d uuid;
begin
 perform public.transport_finance_assert('rent');
 select * into x from public.transport_trip_supplier_rents where id=p_rent_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() for update;
 if not found then raise exception 'Finalized supplier rent required'; end if;t:=public.transport_financial_trip(x.trip_id);
 if exists(select 1 from public.transport_supplier_document_rents where rent_id=x.id and not is_adjustment) then raise exception 'Supplier rent already billed'; end if;
 r:=public.transport_create_service_document('supplier',x.supplier_id,p_date,x.amount,p_with_tax,p_cost_account_id,'Transport Rent '||t.trip_no,p_reference);
 insert into public.transport_supplier_documents(company_id,business_unit_id,operating_location_id,supplier_id,purchase_order_id,journal_entry_id,created_by)
 values(x.company_id,x.business_unit_id,public.current_operating_location_id(),x.supplier_id,(r->>'document_id')::uuid,(r->>'journal_entry_id')::uuid,auth.uid()) returning id into d;
 insert into public.transport_supplier_document_rents(company_id,business_unit_id,document_id,rent_id,trip_id,amount_snapshot,vat_snapshot)
 values(x.company_id,x.business_unit_id,d,x.id,t.id,x.amount,(r->>'vat')::numeric);
 perform public.transport_financial_audit(t.id,'supplier_bill_posted',r||jsonb_build_object('rent_id',x.id,'transport_document_id',d));return r;
end $$;
revoke all on function public.transport_post_supplier_bill(uuid,date,uuid,boolean,text) from public,anon;
grant execute on function public.transport_post_supplier_bill(uuid,date,uuid,boolean,text) to authenticated;
create function public.transport_post_cost(p_trip_id uuid,p_kind text,p_supplier_id uuid,p_amount numeric,p_date date,p_cost_account_id uuid,p_with_tax boolean default false,p_reference text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype;r jsonb;
begin
 perform public.transport_finance_assert('cost');t:=public.transport_financial_trip(p_trip_id);
 r:=public.transport_create_service_document('supplier',p_supplier_id,p_date,p_amount,p_with_tax,p_cost_account_id,'Transport '||p_kind||' '||t.trip_no,p_reference);
 insert into public.transport_service_cost_links(company_id,business_unit_id,trip_id,cost_kind,purchase_order_id,journal_entry_id,amount_snapshot,vat_snapshot,created_by)
 values(t.company_id,t.business_unit_id,t.id,p_kind,(r->>'document_id')::uuid,(r->>'journal_entry_id')::uuid,(r->>'net')::numeric,(r->>'vat')::numeric,auth.uid());
 perform public.transport_financial_audit(t.id,'cost_posted',r||jsonb_build_object('cost_kind',p_kind));return r;
end $$;
revoke all on function public.transport_post_cost(uuid,text,uuid,numeric,date,uuid,boolean,text) from public,anon;
grant execute on function public.transport_post_cost(uuid,text,uuid,numeric,date,uuid,boolean,text) to authenticated;

create function public.attribute_transport_driver_account(p_trip_id uuid,p_source_id uuid,p_amount numeric,p_kind text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype;p record;employee uuid;used numeric;earned numeric;j uuid;
begin
 perform public.transport_finance_assert('driver');t:=public.transport_financial_trip(p_trip_id);
 select employee_id into employee from public.transport_drivers where id=t.driver_id and company_id=t.company_id and business_unit_id=t.business_unit_id;
 if employee is null or coalesce(round(p_amount,2),0)<=0 then raise exception 'Driver Employee mapping and positive amount required'; end if;
 if p_kind='accrual' then
 select employee_id,monthly_salary amount,journal_entry_id into p from public.employee_salary_accruals where id=p_source_id and company_id=t.company_id and business_unit_id=t.business_unit_id for update;
 if not found then raise exception 'Canonical salary accrual required'; end if;
 select coalesce(sum(amount),0) into used from public.transport_driver_accrual_attributions where accrual_id=p_source_id;
 else
 if p_kind<>'payment' then raise exception 'Accrual or payment attribution required'; end if;
 select employee_id,amount,journal_entry_id into p from public.employee_salary_payments where id=p_source_id and company_id=t.company_id and business_unit_id=t.business_unit_id for update;
 if not found then raise exception 'Canonical salary payment required'; end if;
 select coalesce(sum(amount),0) into used from public.transport_driver_payment_attributions where salary_payment_id=p_source_id;
 end if;
 if p.employee_id is distinct from employee or used+round(p_amount,2)>p.amount
 or not exists(select 1 from public.journal_entries where id=p.journal_entry_id and status='posted' and operating_location_id=public.current_operating_location_id())
 or exists(select 1 from public.journal_entries where reversal_of_entry_id=p.journal_entry_id and status='posted') then raise exception 'Unreversed same-employee posted payroll evidence and unallocated amount required'; end if;
 if p_kind='accrual' then
 select coalesce(sum(a.amount),0) into earned from public.transport_driver_accrual_attributions a join public.employee_salary_accruals payroll on payroll.id=a.accrual_id join public.journal_entries j on j.id=payroll.journal_entry_id and j.status='posted' where a.trip_id=t.id and not exists(select 1 from public.journal_entries r where r.reversal_of_entry_id=j.id and r.status='posted');
 if earned+round(p_amount,2)>t.driver_pay then raise exception 'Accrual attribution exceeds agreed driver pay'; end if;
 insert into public.transport_driver_accrual_attributions(company_id,business_unit_id,trip_id,accrual_id,amount,created_by)
 values(t.company_id,t.business_unit_id,t.id,p_source_id,round(p_amount,2),auth.uid());
 else
 select coalesce(sum(a.amount),0) into earned from public.transport_driver_payment_attributions a join public.employee_salary_payments payroll on payroll.id=a.salary_payment_id join public.journal_entries j on j.id=payroll.journal_entry_id and j.status='posted' where a.trip_id=t.id and not exists(select 1 from public.journal_entries r where r.reversal_of_entry_id=j.id and r.status='posted');
 if earned+round(p_amount,2)>t.driver_pay then raise exception 'Payment attribution exceeds agreed driver pay'; end if;
 insert into public.transport_driver_payment_attributions(company_id,business_unit_id,trip_id,salary_payment_id,amount,created_by)
 values(t.company_id,t.business_unit_id,t.id,p_source_id,round(p_amount,2),auth.uid());
 end if;
 perform public.transport_financial_audit(t.id,'driver_'||p_kind||'_attributed',jsonb_build_object('source_id',p_source_id,'amount',p_amount));
 return jsonb_build_object('success',true,'journal_entry_id',p.journal_entry_id);
end $$;
revoke all on function public.attribute_transport_driver_account(uuid,uuid,numeric,text) from public,anon;
grant execute on function public.attribute_transport_driver_account(uuid,uuid,numeric,text) to authenticated;
commit;
