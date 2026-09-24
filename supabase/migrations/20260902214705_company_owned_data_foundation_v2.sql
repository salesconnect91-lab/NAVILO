create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.last_company_id from public.user_profiles p where p.id = auth.uid() and p.is_active = true),
    (select m.company_id from public.company_memberships m join public.companies c on c.id=m.company_id
      where m.user_id=auth.uid() and m.is_active=true and c.status in ('trial','active')
      and (c.subscription_expires_at is null or c.subscription_expires_at > now())
      order by m.created_at asc limit 1)
  );
$$;

grant execute on function public.current_company_id() to authenticated;

create or replace function public.has_module_permission(p_company_id uuid, p_module text, p_action text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_permissions jsonb;
  v_override jsonb;
begin
  if public.is_platform_owner() then return true; end if;
  if not public.has_company_access(p_company_id) then return false; end if;

  select m.role, m.permissions into v_role, v_permissions
  from public.company_memberships m
  where m.company_id = p_company_id and m.user_id = auth.uid() and m.is_active = true
  limit 1;

  v_override := v_permissions #> array[p_module, p_action];
  if v_override is not null then return (v_override #>> '{}')::boolean; end if;

  if v_role in ('company_owner','admin') then return true; end if;

  if p_action = 'view' then
    return case v_role
      when 'accounts' then p_module in ('accounting','reports','master')
      when 'sales' then p_module in ('sales','reports','master','inventory')
      when 'purchase' then p_module in ('purchase','reports','master','inventory')
      when 'store' then p_module in ('inventory','reports','master')
      when 'production' then p_module in ('production','inventory','reports','master')
      when 'viewer' then p_module in ('reports')
      else false end;
  end if;

  if p_action in ('create','edit') then
    return case v_role
      when 'accounts' then p_module = 'accounting'
      when 'sales' then p_module = 'sales'
      when 'purchase' then p_module = 'purchase'
      when 'store' then p_module = 'inventory'
      when 'production' then p_module = 'production'
      else false end;
  end if;

  if p_action = 'delete' then return false; end if;
  if p_action = 'post' then return v_role = 'accounts' and p_module = 'accounting'; end if;
  if p_action = 'print' then return p_module in ('accounting','sales','purchase','inventory','production','reports'); end if;
  return false;
end;
$$;

grant execute on function public.has_module_permission(uuid,text,text) to authenticated;

create table if not exists public.tenant_table_modules (
  table_name text primary key,
  module_key text not null
);

insert into public.tenant_table_modules(table_name,module_key) values
('account_budgets','accounting'),('account_mappings','accounting'),('accounting_periods','accounting'),
('bank_reconciliation_items','accounting'),('bank_reconciliations','accounting'),('chart_of_accounts','accounting'),
('fiscal_year_closures','accounting'),('fiscal_year_opening_balances','accounting'),('fixed_asset_depreciation','accounting'),('fixed_assets','accounting'),
('invoice_payment_allocations','accounting'),('journal_entries','accounting'),('journal_lines','accounting'),('ledgers','accounting'),
('opening_balance_batches','accounting'),('party_ledgers','accounting'),('purchase_payment_allocations','accounting'),
('customers','master'),('suppliers','master'),('employees','master'),('salespersons','master'),('categories','master'),('items','master'),
('uom','master'),('transporters','master'),('company_settings','master'),('company_profile','master'),
('sales_orders','sales'),('sales_order_lines','sales'),('sales_order_charges','sales'),('sales_order_hawala_invoices','sales'),
('sales_consolidations','sales'),('sales_consolidation_invoices','sales'),('consolidated_sales_invoices','sales'),
('consolidated_sales_invoice_lines','sales'),('consolidated_sales_invoice_charges','sales'),
('purchase_orders','purchase'),('purchase_order_lines','purchase'),
('warehouse_stock','inventory'),('stock_movements','inventory'),('warehouses','inventory'),('godowns','inventory'),('gate_passes','inventory'),('hawala_pending_stock','inventory'),('inventory_costs','inventory'),
('work_orders','production'),('work_order_lines','production'),('furnace_yields','production'),('cutting_orders','production'),
('return_notes','inventory'),('return_note_lines','inventory'),('document_print_visibility','reports')
on conflict (table_name) do update set module_key=excluded.module_key;

insert into public.companies(name, code, status, max_users, created_by, notes)
select 'Primary Company', 'MF-PRIMARY', 'active', 25, p.id, 'Migrated from the original single-user MetalForge installation'
from public.user_profiles p
where p.platform_role='super_admin'
order by p.created_at asc
limit 1
on conflict (code) do nothing;

update public.user_profiles p
set last_company_id = c.id, updated_at=now()
from public.companies c
where p.platform_role='super_admin' and c.code='MF-PRIMARY' and p.last_company_id is null;

insert into public.company_memberships(company_id,user_id,role,is_active,permissions,invited_by)
select c.id,p.id,'company_owner',true,'{}'::jsonb,p.id
from public.companies c
join public.user_profiles p on p.platform_role='super_admin'
where c.code='MF-PRIMARY'
on conflict (company_id,user_id) do update set role='company_owner', is_active=true, updated_at=now();

do $$
declare
  r record;
  pol record;
  fallback_company uuid;
  fk_name text;
begin
  select id into fallback_company from public.companies where code='MF-PRIMARY' limit 1;

  for r in
    select m.table_name, m.module_key
    from public.tenant_table_modules m
    join information_schema.tables t on t.table_schema='public' and t.table_name=m.table_name and t.table_type='BASE TABLE'
  loop
    execute format('alter table public.%I add column if not exists company_id uuid', r.table_name);
    execute format('alter table public.%I disable trigger user', r.table_name);

    if exists (select 1 from information_schema.columns where table_schema='public' and table_name=r.table_name and column_name='user_id') then
      execute format($sql$
        update public.%I x set company_id = coalesce(
          (select p.last_company_id from public.user_profiles p where p.id=x.user_id),
          (select m.company_id from public.company_memberships m where m.user_id=x.user_id and m.is_active=true order by m.created_at asc limit 1),
          $1
        ) where company_id is null
      $sql$, r.table_name) using fallback_company;
    else
      execute format('update public.%I set company_id=$1 where company_id is null', r.table_name) using fallback_company;
    end if;

    execute format('alter table public.%I alter column company_id set default public.current_company_id()', r.table_name);
    execute format('alter table public.%I alter column company_id set not null', r.table_name);

    fk_name := r.table_name || '_company_id_fkey';
    if not exists (select 1 from pg_constraint where conname=fk_name) then
      execute format('alter table public.%I add constraint %I foreign key (company_id) references public.companies(id) on delete restrict', r.table_name, fk_name);
    end if;

    execute format('create index if not exists %I on public.%I(company_id)', 'idx_'||r.table_name||'_company_id', r.table_name);
    execute format('alter table public.%I enable row level security', r.table_name);

    for pol in select policyname from pg_policies where schemaname='public' and tablename=r.table_name loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, r.table_name);
    end loop;

    execute format('create policy %I on public.%I for select to authenticated using (public.has_module_permission(company_id,%L,%L))', 'tenant_select_'||r.table_name, r.table_name, r.module_key, 'view');
    execute format('create policy %I on public.%I for insert to authenticated with check (company_id=public.current_company_id() and public.has_module_permission(company_id,%L,%L))', 'tenant_insert_'||r.table_name, r.table_name, r.module_key, 'create');
    execute format('create policy %I on public.%I for update to authenticated using (public.has_module_permission(company_id,%L,%L)) with check (company_id=public.current_company_id() and public.has_module_permission(company_id,%L,%L))', 'tenant_update_'||r.table_name, r.table_name, r.module_key, 'edit', r.module_key, 'edit');
    execute format('create policy %I on public.%I for delete to authenticated using (public.has_module_permission(company_id,%L,%L))', 'tenant_delete_'||r.table_name, r.table_name, r.module_key, 'delete');

    execute format('alter table public.%I enable trigger user', r.table_name);
  end loop;
end $$;

alter table public.tenant_table_modules enable row level security;
drop policy if exists tenant_table_modules_owner_select on public.tenant_table_modules;
create policy tenant_table_modules_owner_select on public.tenant_table_modules for select to authenticated using (public.is_platform_owner());
