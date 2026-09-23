-- Restore the dynamic purchase charge foundation that exists in production before person-performance reporting.
create table if not exists public.purchase_order_charges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default public.legacy_data_user_id(),
  company_id uuid not null default public.current_company_id(),
  business_unit_id uuid not null default public.current_business_unit_id(),
  order_id uuid not null references public.purchase_orders(id) on delete cascade,
  charge_key text not null,
  charge_label text not null,
  amount numeric not null default 0 check (amount >= 0),
  tax_percent numeric not null default 0 check (tax_percent >= 0 and tax_percent <= 100),
  treatment text not null default 'landed_cost' check (treatment in ('landed_cost','expense')),
  cost_account_id uuid null references public.chart_of_accounts(id) on delete set null,
  quantity numeric null,
  rate numeric null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id, charge_key)
);
alter table public.purchase_order_charges enable row level security;
drop policy if exists purchase_order_charges_select on public.purchase_order_charges;
create policy purchase_order_charges_select on public.purchase_order_charges for select to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id());
drop policy if exists purchase_order_charges_insert on public.purchase_order_charges;
create policy purchase_order_charges_insert on public.purchase_order_charges for insert to authenticated with check (user_id=public.legacy_data_user_id() and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id());
drop policy if exists purchase_order_charges_update on public.purchase_order_charges;
create policy purchase_order_charges_update on public.purchase_order_charges for update to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id()) with check (user_id=public.legacy_data_user_id() and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id());
drop policy if exists purchase_order_charges_delete on public.purchase_order_charges;
create policy purchase_order_charges_delete on public.purchase_order_charges for delete to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id());
grant select,insert,update,delete on public.purchase_order_charges to authenticated;
