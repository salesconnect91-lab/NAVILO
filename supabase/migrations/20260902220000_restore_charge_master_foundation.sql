-- Restore the legacy Charge Master foundation required by later company-scope migrations.
-- This table shape is reconstructed from the verified live schema and the later
-- migration assumptions (legacy user-owned key, pre-company-scope columns only).

create table if not exists public.charge_master (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  charge_key text not null,
  charge_name text not null,
  charge_type text not null default 'recovery'
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
create policy charge_master_select_own
  on public.charge_master for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists charge_master_insert_own on public.charge_master;
create policy charge_master_insert_own
  on public.charge_master for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists charge_master_update_own on public.charge_master;
create policy charge_master_update_own
  on public.charge_master for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists charge_master_delete_own on public.charge_master;
create policy charge_master_delete_own
  on public.charge_master for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.charge_master to authenticated;
