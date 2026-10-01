-- NAVILO Fresh Transport V1 foundation
-- Additive transport-domain schema only. No accounting posting functions are replaced.

create table if not exists public.transport_trip_sequences (
  company_id uuid primary key references public.companies(id) on delete cascade,
  last_no bigint not null default 0 check(last_no>=0),
  updated_at timestamptz not null default now()
);

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

create table if not exists public.transport_vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  vehicle_no text not null,
  truck_type_id uuid references public.transport_truck_types(id) on delete restrict,
  ownership_type text not null default 'company' check(ownership_type in ('company','supplier')),
  supplier_id uuid references public.suppliers(id) on delete restrict,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(company_id,business_unit_id,vehicle_no)
);

create table if not exists public.transport_drivers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete restrict,
  driver_name text not null,
  mobile text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(company_id,business_unit_id,driver_name)
);

create table if not exists public.transport_trips (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  trip_no text not null,
  trip_date date not null default current_date,
  customer_id uuid references public.customers(id) on delete restrict,
  customer_name_snapshot text,
  vehicle_id uuid references public.transport_vehicles(id) on delete restrict,
  driver_id uuid references public.transport_drivers(id) on delete restrict,
  from_location text not null,
  to_location text not null,
  po_do_job_no text,
  ppr_status text not null default 'pending' check(ppr_status in ('pending','received','not_required')),
  ppr_received_by uuid references public.employees(id) on delete restrict,
  ppr_received_date date,
  ppr_attachment_path text,
  job_status text not null default 'open' check(job_status in ('open','in_progress','completed','cancelled')),
  trip_status text not null default 'draft' check(trip_status in ('draft','running','completed','cancelled')),
  customer_rate numeric(18,2),
  customer_rate_status text not null default 'pending' check(customer_rate_status in ('pending','finalized')),
  supplier_rent numeric(18,2),
  supplier_rent_status text not null default 'pending' check(supplier_rent_status in ('pending','finalized')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,trip_no)
);
create index if not exists transport_trips_scope_date_idx on public.transport_trips(company_id,business_unit_id,trip_date desc);
create index if not exists transport_trips_search_idx on public.transport_trips(company_id,trip_no);

create table if not exists public.transport_trip_audit (
  id bigint generated always as identity primary key,
  company_id uuid not null,
  business_unit_id uuid not null,
  trip_id uuid not null references public.transport_trips(id) on delete restrict,
  event_type text not null,
  old_data jsonb,
  new_data jsonb,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create table if not exists public.transport_driver_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  trip_id uuid references public.transport_trips(id) on delete restrict,
  driver_id uuid not null references public.transport_drivers(id) on delete restrict,
  expense_date date not null default current_date,
  expense_type text not null,
  amount numeric(18,2) not null check(amount>=0),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.next_transport_trip_no()
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_company uuid; v_no bigint;
begin
  v_company:=public.current_company_id();
  if v_company is null then raise exception 'No active company.'; end if;
  if not public.has_module_permission(v_company,'transport','create') then raise exception 'Transport create permission required.'; end if;
  insert into public.transport_trip_sequences(company_id,last_no) values(v_company,1)
  on conflict(company_id) do update set last_no=public.transport_trip_sequences.last_no+1,updated_at=now()
  returning last_no into v_no;
  return 'TRP-'||lpad(v_no::text,7,'0');
end$$;
revoke all on function public.next_transport_trip_no() from public,anon;
grant execute on function public.next_transport_trip_no() to authenticated;

create or replace function public.transport_v1_stamp()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='INSERT' then
    new.company_id:=coalesce(new.company_id,public.current_company_id());
    new.business_unit_id:=coalesce(new.business_unit_id,public.current_business_unit_id());
    new.created_by:=coalesce(new.created_by,auth.uid());
    if tg_table_name='transport_trips' and (new.trip_no is null or btrim(new.trip_no)='') then
      new.trip_no:=public.next_transport_trip_no();
    end if;
  end if;
  if new.company_id is distinct from public.current_company_id()
     or new.business_unit_id is distinct from public.current_business_unit_id() then
    raise exception 'Transport record must belong to the active company and business unit.';
  end if;
  if not exists(select 1 from public.business_units b where b.id=new.business_unit_id and b.company_id=new.company_id and b.unit_type='transport' and b.is_active) then
    raise exception 'An active Transport business unit is required.';
  end if;
  if tg_table_name='transport_trips' then new.updated_by:=auth.uid(); new.updated_at:=now(); end if;
  return new;
end$$;
revoke all on function public.transport_v1_stamp() from public,anon,authenticated;

do $$
declare t text;
begin
  foreach t in array array['transport_truck_types','transport_locations','transport_vehicles','transport_drivers','transport_trips','transport_driver_expenses']
  loop
    execute format('drop trigger if exists trg_%I_scope on public.%I',t,t);
    execute format('create trigger trg_%I_scope before insert or update on public.%I for each row execute function public.transport_v1_stamp()',t,t);
  end loop;
end$$;

create or replace function public.transport_trip_audit_capture()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,event_type,old_data,new_data,changed_by)
  values(coalesce(new.company_id,old.company_id),coalesce(new.business_unit_id,old.business_unit_id),
         coalesce(new.id,old.id),lower(tg_op),case when tg_op='INSERT' then null else to_jsonb(old) end,
         case when tg_op='DELETE' then null else to_jsonb(new) end,auth.uid());
  return coalesce(new,old);
end$$;
revoke all on function public.transport_trip_audit_capture() from public,anon,authenticated;
drop trigger if exists trg_transport_trip_audit on public.transport_trips;
create trigger trg_transport_trip_audit after insert or update or delete on public.transport_trips for each row execute function public.transport_trip_audit_capture();

do $$
declare t text;
begin
  foreach t in array array['transport_truck_types','transport_locations','transport_vehicles','transport_drivers','transport_trips','transport_trip_audit','transport_driver_expenses']
  loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t||'_read',t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,''transport'',''view''))',t||'_read',t);
    if t <> 'transport_trip_audit' then
      execute format('drop policy if exists %I on public.%I',t||'_insert',t);
      execute format('create policy %I on public.%I for insert to authenticated with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,''transport'',''create''))',t||'_insert',t);
      execute format('drop policy if exists %I on public.%I',t||'_update',t);
      execute format('create policy %I on public.%I for update to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,''transport'',''edit'')) with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id())',t||'_update',t);
    end if;
  end loop;
end$$;

revoke all on public.transport_trip_sequences,public.transport_truck_types,public.transport_locations,public.transport_vehicles,public.transport_drivers,public.transport_trips,public.transport_trip_audit,public.transport_driver_expenses from public,anon;
grant select on public.transport_trip_sequences,public.transport_trip_audit to authenticated;
grant select,insert,update on public.transport_truck_types,public.transport_locations,public.transport_vehicles,public.transport_drivers,public.transport_trips,public.transport_driver_expenses to authenticated;

create or replace view public.transport_trip_register with(security_invoker=true) as
select t.id,t.company_id,t.business_unit_id,t.trip_no,t.trip_date,t.trip_status,t.job_status,t.ppr_status,t.po_do_job_no,
       coalesce(c.name,t.customer_name_snapshot) customer_name,
       v.vehicle_no,d.driver_name,t.from_location,t.to_location,
       t.customer_rate,t.customer_rate_status,t.supplier_rent,t.supplier_rent_status,
       case when t.customer_rate is null or t.supplier_rent is null then null else t.customer_rate-t.supplier_rent end trip_margin,
       t.created_at,t.updated_at
from public.transport_trips t
left join public.customers c on c.id=t.customer_id
left join public.transport_vehicles v on v.id=t.vehicle_id
left join public.transport_drivers d on d.id=t.driver_id;
revoke all on public.transport_trip_register from public,anon;
grant select on public.transport_trip_register to authenticated;
