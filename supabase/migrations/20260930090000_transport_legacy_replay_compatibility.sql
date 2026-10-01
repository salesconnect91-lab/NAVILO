-- Replay-only compatibility for the legacy tables that already exist when
-- the fresh V1 IF NOT EXISTS foundation runs. No historical migration edit.
-- Ordered before 20260930100000 deliberately; existing databases must apply
-- this missing migration explicitly before the later completion migrations.
begin;
create table if not exists public.transport_truck_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(company_id,business_unit_id,name)
);

create table if not exists public.transport_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(company_id,business_unit_id,name)
);

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

do $$begin
 if exists(select 1 from information_schema.views where table_schema='public' and table_name='transport_trip_register')
 and exists(select 1 from information_schema.columns where table_schema='public' and table_name='transport_trip_register' and column_name='status')
 and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='transport_trip_register' and column_name='trip_status')
 and not exists(select 1 from information_schema.views where table_schema='public' and table_name='transport_trip_register_legacy_foundation') then
 alter view public.transport_trip_register rename to transport_trip_register_legacy_foundation;
 end if;
end $$;
commit;
