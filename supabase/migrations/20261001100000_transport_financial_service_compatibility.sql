-- Forward-only Transport financial compatibility. No historical rows are fabricated.
begin;
-- The earlier IF NOT EXISTS foundation leaves legacy tables without these fields.
alter table public.transport_vehicles add column if not exists truck_type_id uuid references public.transport_truck_types(id) on delete restrict,
 add column if not exists ownership_type text check(ownership_type in ('company','supplier'));
alter table public.transport_trips add column if not exists truck_type_id uuid references public.transport_truck_types(id) on delete restrict,
 add column if not exists trip_status text not null default 'draft',
 add column if not exists job_status text not null default 'open',
 add column if not exists customer_rate_status text not null default 'pending',
 add column if not exists supplier_rent numeric(18,2),
 add column if not exists supplier_rent_status text not null default 'pending',
 add column if not exists ppr_received_by uuid references auth.users(id) on delete restrict,
 add column if not exists ppr_received_date date,
 add column if not exists ppr_attachment_path text,
 add column if not exists updated_by uuid references auth.users(id);
-- Repair the shared fresh foundation trigger: PostgreSQL resolves NEW fields
-- before boolean short-circuiting, so Trip-only access must be nested.
create or replace function public.transport_v1_stamp() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' then
 new.company_id:=coalesce(new.company_id,public.current_company_id());
 new.business_unit_id:=coalesce(new.business_unit_id,public.current_business_unit_id());
 new.created_by:=coalesce(new.created_by,auth.uid());
 end if;
 if new.company_id is distinct from public.current_company_id() or new.business_unit_id is distinct from public.current_business_unit_id()
 then raise exception 'Transport record must belong to active company and business unit';end if;
 if not exists(select 1 from public.business_units where id=new.business_unit_id and company_id=new.company_id and unit_type='transport' and is_active)
 then raise exception 'Active Transport business unit required';end if;
 if tg_table_name='transport_trips' then
 if tg_op='INSERT' then
 if new.trip_no is null or btrim(new.trip_no)='' then new.trip_no:=public.next_transport_trip_no();end if;
 new.customer_rate:=coalesce(new.customer_rate,0);
 new.owner_rent:=coalesce(new.supplier_rent,new.owner_rent,0);
 new.supplier_rent:=new.owner_rent;
 else
 if new.owner_rent is distinct from old.owner_rent then new.supplier_rent:=new.owner_rent;
 elsif new.supplier_rent is distinct from old.supplier_rent then new.owner_rent:=coalesce(new.supplier_rent,0);end if;
 end if;
 new.updated_by:=auth.uid();new.updated_at:=now();
 end if;
 return new;
end $$;
revoke all on function public.transport_v1_stamp() from public,anon,authenticated;
-- Seed number allocation from known existing TRP numbers without renumbering.
insert into public.transport_trip_sequences(company_id,last_no)
select company_id,coalesce(max(substring(trip_no from '^TRP-([0-9]+)$')::bigint),0)
from public.transport_trips group by company_id
on conflict(company_id) do update set last_no=greatest(public.transport_trip_sequences.last_no,excluded.last_no);
-- Abort rather than silently renumber any cross-BU legacy duplicate.
create unique index if not exists transport_financial_trip_no_company_uq on public.transport_trips(company_id,trip_no);
-- Canonical Sales/Purchase service branch. Existing inventory functions are
-- preserved verbatim under private names; only explicit service orders dispatch
-- to the new posting paths. No item, godown or stock row is synthesized.
alter table public.sales_orders add column if not exists document_kind text not null default 'inventory'
 check(document_kind in ('inventory','service'));
alter table public.purchase_orders add column if not exists document_kind text not null default 'inventory'
 check(document_kind in ('inventory','service'));

create table if not exists public.sales_service_lines(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,business_unit_id uuid not null,
 order_id uuid not null references public.sales_orders(id) on delete restrict,
 description text not null check(btrim(description)<>''),amount numeric(18,2) not null check(amount>0),
 tax_percent numeric(7,4) not null default 0 check(tax_percent between 0 and 100),
 source_module text,source_id uuid,created_by uuid,created_at timestamptz not null default now(),
 unique(order_id,source_module,source_id));
create index if not exists sales_service_lines_order_idx on public.sales_service_lines(company_id,business_unit_id,order_id);
create table if not exists public.purchase_service_lines(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,business_unit_id uuid not null,
 order_id uuid not null references public.purchase_orders(id) on delete restrict,
 description text not null check(btrim(description)<>''),amount numeric(18,2) not null check(amount>0),
 tax_percent numeric(7,4) not null default 0 check(tax_percent between 0 and 100),
 cost_account_id uuid not null references public.chart_of_accounts(id) on delete restrict,
 source_module text,source_id uuid,created_by uuid,created_at timestamptz not null default now(),
 unique(order_id,source_module,source_id));
create index if not exists purchase_service_lines_order_idx on public.purchase_service_lines(company_id,business_unit_id,order_id);

create function public.guard_service_document_line() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare o record;v_module text:=case when tg_table_name='sales_service_lines' then 'sales' else 'purchase' end;
begin
 if tg_op='DELETE' then raise exception 'Service line history is append-only'; end if;
 if new.company_id is distinct from public.current_company_id()
    or new.business_unit_id is distinct from public.current_business_unit_id()
    or not public.has_module_permission(new.company_id,v_module,
      case when tg_op='INSERT' then 'create' else 'edit' end)
 then raise exception 'Service line permission or tenant mismatch'; end if;
 if tg_table_name='sales_service_lines' then
  select company_id,business_unit_id,status,document_kind,invoice_type,tax_percent
    into o from public.sales_orders where id=new.order_id;
 else
  select company_id,business_unit_id,status,document_kind,invoice_type,tax_percent
    into o from public.purchase_orders where id=new.order_id;
  if not exists(select 1 from public.chart_of_accounts a where a.id=new.cost_account_id
   and a.company_id=new.company_id and a.type='expense' and a.is_active and not a.is_group)
  then raise exception 'Active company service expense account required'; end if;
 end if;
 if o.company_id is distinct from new.company_id or o.business_unit_id is distinct from new.business_unit_id
    or o.document_kind<>'service' or o.status='posted'
    or new.tax_percent is distinct from (case when o.invoice_type='Tax Invoice' then o.tax_percent else 0 end)
 then raise exception 'Draft service document and tax snapshot required'; end if;
 if tg_op='UPDATE' and (to_jsonb(new)-'description'-'amount'-'tax_percent'-'cost_account_id')
   is distinct from (to_jsonb(old)-'description'-'amount'-'tax_percent'-'cost_account_id')
 then raise exception 'Service line identity is immutable'; end if;
 if tg_op='INSERT' then new.created_by:=auth.uid(); end if;
 return new;
end $$;
revoke all on function public.guard_service_document_line() from public,anon,authenticated;
create function public.guard_service_document_kind() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' and new.document_kind is distinct from old.document_kind then
  if old.status='posted' or new.status='posted'
   or (tg_table_name='sales_orders' and
    (exists(select 1 from public.sales_order_lines where order_id=old.id)
     or exists(select 1 from public.sales_service_lines where order_id=old.id)))
   or (tg_table_name='purchase_orders' and
    (exists(select 1 from public.purchase_order_lines where order_id=old.id)
     or exists(select 1 from public.purchase_service_lines where order_id=old.id)))
  then raise exception 'Document kind cannot change after adding lines or posting'; end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_service_document_kind() from public,anon,authenticated;
create trigger zz_sales_document_kind_guard before update of document_kind on public.sales_orders
 for each row execute function public.guard_service_document_kind();
create trigger zz_purchase_document_kind_guard before update of document_kind on public.purchase_orders
 for each row execute function public.guard_service_document_kind();
create trigger sales_service_line_guard before insert or update or delete on public.sales_service_lines
 for each row execute function public.guard_service_document_line();
create trigger purchase_service_line_guard before insert or update or delete on public.purchase_service_lines
 for each row execute function public.guard_service_document_line();
do $$ declare t text;m text;begin
 foreach t in array array['sales_service_lines','purchase_service_lines'] loop
  m:=case when t='sales_service_lines' then 'sales' else 'purchase' end;
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy %I on public.%I for select to authenticated using(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,%L,''view''))',t||'_read',t,m);
  execute format('create policy %I on public.%I for insert to authenticated with check(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,%L,''create''))',t||'_insert',t,m);
  execute format('create policy %I on public.%I for update to authenticated using(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,%L,''edit'')) with check(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id())',t||'_update',t,m);
  execute format('grant select,insert,update on public.%I to authenticated',t);
 end loop;
end $$;

create function public.post_service_sales_invoice_core(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare o public.sales_orders%rowtype;v_sub numeric;v_vat numeric;v_total numeric;v_ar uuid;v_rev uuid;
 v_tax uuid;v_j uuid;v_customer text;v_delta numeric;v_account uuid;
begin
 perform public.assert_module_permission('sales','post');
 select * into o from public.sales_orders where id=p_order_id and company_id=public.current_company_id()
  and business_unit_id=public.current_business_unit_id()
  and operating_location_id=public.current_operating_location_id() for update;
 if not found or o.document_kind<>'service' or o.status='posted'
    or exists(select 1 from public.sales_order_lines where order_id=p_order_id)
    or exists(select 1 from public.consolidated_sales_invoices where main_sales_order_id=p_order_id)
    or public.discount_amount_for('sales_main',o.order_no)<>0
 then raise exception 'Eligible service Sales document without inventory lines required'; end if;
 select coalesce(sum(amount),0),coalesce(sum(round(amount*tax_percent/100,2)),0)
 into v_sub,v_vat from public.sales_service_lines where order_id=o.id and company_id=o.company_id and business_unit_id=o.business_unit_id;
 if v_sub<=0 or o.customer_id is null then raise exception 'Customer and positive service lines required'; end if;
 v_total:=round(v_sub+v_vat,2);
 v_ar:=public.fx_mapping_account(o.user_id,o.company_id,'accounts_receivable','asset');
 v_rev:=public.fx_mapping_account(o.user_id,o.company_id,'service_revenue','revenue');
 if v_vat>0 then v_tax:=public.fx_mapping_account(o.user_id,o.company_id,'output_vat','liability'); end if;
 select name into v_customer from public.customers where id=o.customer_id and company_id=o.company_id
   and user_id=o.user_id and account_id=v_ar;
 if v_customer is null then raise exception 'Customer/AR mapping mismatch'; end if;
 insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,
  entry_no,entry_date,description,status,party_name,trans_type,source_module,source_document_type,source_document_id)
 values(o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,o.order_no,o.order_date,
   'Service Sales Invoice '||o.order_no,'draft',v_customer,'Sales Invoice','sales','sales_invoice',o.id)
 returning id into v_j;
 insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,
  account_id,account,debit,credit,party_type,party_id,party_name)
 select o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,v_j,a.id,a.code||' - '||a.name,
   v_total,0,'customer',o.customer_id,v_customer from public.chart_of_accounts a where a.id=v_ar;
 insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,
  account_id,account,debit,credit)
 select o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,v_j,a.id,a.code||' - '||a.name,
   0,v_sub from public.chart_of_accounts a where a.id=v_rev;
 if v_vat>0 then
  insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,
   account_id,account,debit,credit)
  select o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,v_j,a.id,a.code||' - '||a.name,
   0,v_vat from public.chart_of_accounts a where a.id=v_tax;
 end if;
 perform public.post_journal_entry(v_j);
 update public.sales_orders set status='posted',total=v_total,posted_at=now(),posted_by=auth.uid(),updated_at=now()
 where id=o.id and status<>'posted';
 return jsonb_build_object('success',true,'order_id',o.id,'journal_entry_id',v_j,
  'subtotal_excluding_vat',v_sub,'vat',v_vat,'grand_total',v_total,'status','posted');
end $$;
revoke all on function public.post_service_sales_invoice_core(uuid) from public,anon,authenticated;

create function public.post_service_purchase_invoice_core(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare o public.purchase_orders%rowtype;v_sub numeric;v_vat numeric;v_total numeric;v_ap uuid;v_tax uuid;
 v_name text;v_j uuid;v_delta numeric;v_cost uuid;r record;
begin
 perform public.assert_module_permission('purchase','post');
 select * into o from public.purchase_orders where id=p_order_id and company_id=public.current_company_id()
  and business_unit_id=public.current_business_unit_id()
  and operating_location_id=public.current_operating_location_id() for update;
 if not found or o.document_kind<>'service' or o.status='posted'
  or exists(select 1 from public.purchase_order_lines where order_id=o.id)
  or exists(select 1 from public.purchase_order_consolidated_invoices where purchase_order_id=o.id)
  or public.discount_amount_for('purchase_main',o.order_no)<>0
 then raise exception 'Eligible service Purchase document without inventory lines required'; end if;
 select coalesce(sum(amount),0),coalesce(sum(round(amount*tax_percent/100,2)),0)
  into v_sub,v_vat from public.purchase_service_lines where order_id=o.id;
 if v_sub<=0 or o.supplier_id is null then raise exception 'Supplier and positive service lines required'; end if;
 v_total:=round(v_sub+v_vat,2);
 v_ap:=public.fx_mapping_account(o.user_id,o.company_id,'accounts_payable','liability');
 if v_vat>0 then v_tax:=public.fx_mapping_account(o.user_id,o.company_id,'input_vat','asset'); end if;
 select name into v_name from public.suppliers where id=o.supplier_id and company_id=o.company_id
  and user_id=o.user_id and account_id=v_ap;
 if v_name is null then raise exception 'Supplier/AP mapping mismatch'; end if;
 insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,
  entry_no,entry_date,description,status,party_name,trans_type,source_module,source_document_type,source_document_id)
 values(o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,'PUR-'||o.order_no,o.order_date,
  'Service Purchase Invoice '||o.order_no,'draft',v_name,'Purchase','purchase','purchase_invoice',o.id)
 returning id into v_j;
 for r in select cost_account_id,sum(amount) amount from public.purchase_service_lines
   where order_id=o.id group by cost_account_id loop
  insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,
   account_id,account,debit,credit)
  select o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,v_j,a.id,a.code||' - '||a.name,
    r.amount,0 from public.chart_of_accounts a where a.id=r.cost_account_id and a.company_id=o.company_id
    and a.type='expense' and a.is_active and not a.is_group;
  if not found then raise exception 'Active service expense account required'; end if;
 end loop;
 if v_vat>0 then
  insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,
   account_id,account,debit,credit)
  select o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,v_j,a.id,a.code||' - '||a.name,
    v_vat,0 from public.chart_of_accounts a where a.id=v_tax;
 end if;
 insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,
  account_id,account,debit,credit,party_type,party_id,party_name)
 select o.user_id,o.company_id,o.business_unit_id,o.operating_location_id,v_j,a.id,a.code||' - '||a.name,
  0,v_total,'supplier',o.supplier_id,v_name from public.chart_of_accounts a where a.id=v_ap;
 perform public.post_journal_entry(v_j);
 update public.purchase_orders set status='posted',total=v_total,posted_at=now(),posted_by=auth.uid(),updated_at=now()
  where id=o.id and status<>'posted';
 return jsonb_build_object('success',true,'order_id',o.id,'journal_entry_id',v_j,
  'subtotal_excluding_vat',v_sub,'vat',v_vat,'grand_total',v_total,'status','posted');
end $$;
revoke all on function public.post_service_purchase_invoice_core(uuid) from public,anon,authenticated;

-- Retain the entire current inventory dispatchers under private entry points.
alter function public.post_sales_invoice(uuid) rename to post_sales_invoice_inventory_dispatch;
alter function public.post_purchase_invoice(uuid) rename to post_purchase_invoice_inventory_dispatch;
revoke all on function public.post_sales_invoice_inventory_dispatch(uuid),public.post_purchase_invoice_inventory_dispatch(uuid) from public,anon,authenticated;
create function public.post_sales_invoice(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare k text;
begin
 perform public.assert_module_permission('sales','post');
 select document_kind into k from public.sales_orders where id=p_order_id
 and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id()
 and operating_location_id=public.current_operating_location_id() for update;
 if not found then raise exception 'Sales document outside active workspace'; end if;
 if k='service' then return public.post_service_sales_invoice_core(p_order_id); end if;
 return public.post_sales_invoice_inventory_dispatch(p_order_id);
end $$;
create function public.post_purchase_invoice(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare k text;
begin
 perform public.assert_module_permission('purchase','post');
 select document_kind into k from public.purchase_orders where id=p_order_id
 and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id()
 and operating_location_id=public.current_operating_location_id() for update;
 if not found then raise exception 'Purchase document outside active workspace'; end if;
 if k='service' then return public.post_service_purchase_invoice_core(p_order_id); end if;
 return public.post_purchase_invoice_inventory_dispatch(p_order_id);
end $$;
revoke all on function public.post_sales_invoice(uuid),public.post_purchase_invoice(uuid) from public,anon;
grant execute on function public.post_sales_invoice(uuid),public.post_purchase_invoice(uuid) to authenticated;
-- These Transport UI rates are in company base currency; require the same for
-- service documents rather than silently mixing source/base currency amounts.
create function public.guard_transport_service_currency() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.document_kind='service' and (coalesce(new.currency_code,'')<>(select base_currency_code from public.companies where id=new.company_id)
 or coalesce(new.exchange_rate,0)<>1) then raise exception 'Transport service billing requires company base currency and rate 1'; end if;
 return new;
end $$;
revoke all on function public.guard_transport_service_currency() from public,anon,authenticated;
create trigger zzzz_service_currency before insert or update on public.sales_orders for each row execute function public.guard_transport_service_currency();
create trigger zzzz_service_currency before insert or update on public.purchase_orders for each row execute function public.guard_transport_service_currency();
commit;
