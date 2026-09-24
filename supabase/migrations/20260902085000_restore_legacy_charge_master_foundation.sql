-- The hosted database pre-dated the recorded migration history.  The original
-- Charge Master table was created outside the repository, but migration 0046
-- already reads it.  This is the earliest evidenced shape: current live
-- ordinals 1-13, excluding fields whose later repository migrations add.
-- Later company-scope, rate, actor, Urdu and purchase-treatment migrations
-- remain authoritative for those additions and constraints.

create table if not exists public.charge_master (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  charge_key text not null,
  charge_name text not null,
  charge_type text not null default 'recovery'
    constraint charge_master_charge_type_check
    check (charge_type in ('recovery','cost','both')),
  revenue_account_id uuid references public.chart_of_accounts(id) on delete set null,
  cost_account_id uuid references public.chart_of_accounts(id) on delete set null,
  tax_applicable boolean not null default false,
  service_party_required boolean not null default false,
  is_active boolean not null default true,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint charge_master_user_key_unique unique (user_id, charge_key)
);

alter table public.charge_master enable row level security;

drop policy if exists charge_master_select_own on public.charge_master;
create policy charge_master_select_own on public.charge_master
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists charge_master_insert_own on public.charge_master;
create policy charge_master_insert_own on public.charge_master
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists charge_master_update_own on public.charge_master;
create policy charge_master_update_own on public.charge_master
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists charge_master_delete_own on public.charge_master;
create policy charge_master_delete_own on public.charge_master
  for delete to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on public.charge_master to authenticated;

