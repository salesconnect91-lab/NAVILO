-- Transport operational foundation: additive, business-unit scoped, no changes to existing NAVILO accounting/sales tables.

create table if not exists public.transport_vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  vehicle_no text not null,
  truck_type text,
  owner_type text not null default 'company' check (owner_type in ('company','supplier','other')),
  owner_name text,
  supplier_id uuid null references public.suppliers(id) on delete set null,
  registration_no text,
  is_active boolean not null default true,
  notes text,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,business_unit_id,vehicle_no)
);
create index if not exists transport_vehicles_lookup_idx on public.transport_vehicles(company_id,business_unit_id,vehicle_no);

create table if not exists public.transport_drivers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  driver_code text,
  driver_name text not null,
  mobile text,
  owner_name text,
  employee_id uuid null references public.employees(id) on delete set null,
  is_active boolean not null default true,
  notes text,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,business_unit_id,driver_name)
);
create index if not exists transport_drivers_lookup_idx on public.transport_drivers(company_id,business_unit_id,driver_name);

create table if not exists public.transport_trips (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  trip_no text not null,
  trip_date date not null default current_date,
  customer_id uuid null references public.customers(id) on delete restrict,
  customer_name_snapshot text,
  vehicle_id uuid null references public.transport_vehicles(id) on delete restrict,
  driver_id uuid null references public.transport_drivers(id) on delete restrict,
  owner_name_snapshot text,
  truck_type text,
  po_do_job_no text,
  from_location text,
  to_location text,
  service_period text,
  ppr_status text not null default 'pending' check (ppr_status in ('pending','received','not_required')),
  status text not null default 'draft' check (status in ('draft','running','completed','ready_to_invoice','invoiced','paid','cancelled')),
  customer_rate numeric(18,2) not null default 0 check (customer_rate>=0),
  driver_pay numeric(18,2) not null default 0 check (driver_pay>=0),
  owner_rent numeric(18,2) not null default 0 check (owner_rent>=0),
  fuel_cost numeric(18,2) not null default 0 check (fuel_cost>=0),
  toll_cost numeric(18,2) not null default 0 check (toll_cost>=0),
  other_cost numeric(18,2) not null default 0 check (other_cost>=0),
  sales_order_id uuid null references public.sales_orders(id) on delete set null,
  notes text,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,business_unit_id,trip_no)
);
create index if not exists transport_trips_search_idx on public.transport_trips(company_id,business_unit_id,trip_date desc,trip_no);
create index if not exists transport_trips_customer_idx on public.transport_trips(company_id,business_unit_id,customer_id,trip_date desc);
create index if not exists transport_trips_vehicle_idx on public.transport_trips(company_id,business_unit_id,vehicle_id,trip_date desc);
create index if not exists transport_trips_driver_idx on public.transport_trips(company_id,business_unit_id,driver_id,trip_date desc);

create table if not exists public.transport_trip_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  trip_id uuid not null references public.transport_trips(id) on delete cascade,
  expense_date date not null default current_date,
  expense_type text not null,
  amount numeric(18,2) not null check (amount>=0),
  description text,
  journal_entry_id uuid null references public.journal_entries(id) on delete set null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists transport_trip_expenses_trip_idx on public.transport_trip_expenses(company_id,business_unit_id,trip_id,expense_date);

create or replace function public.transport_stamp_scope()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='INSERT' then
    new.company_id:=coalesce(new.company_id,public.current_company_id());
    new.business_unit_id:=coalesce(new.business_unit_id,public.current_business_unit_id());
    new.created_by:=coalesce(new.created_by,auth.uid());
  end if;
  if new.company_id is distinct from public.current_company_id() or new.business_unit_id is distinct from public.current_business_unit_id() then
    raise exception 'Transport record must belong to the active company and business unit.';
  end if;
  if not exists(select 1 from public.business_units b where b.id=new.business_unit_id and b.company_id=new.company_id and b.unit_type='transport' and b.is_active) then
    raise exception 'Transport records require an active Transport business unit.';
  end if;
  new.updated_at:=now();
  return new;
end$$;
revoke all on function public.transport_stamp_scope() from public,anon,authenticated;

drop trigger if exists trg_transport_vehicles_scope on public.transport_vehicles;
create trigger trg_transport_vehicles_scope before insert or update on public.transport_vehicles for each row execute function public.transport_stamp_scope();
drop trigger if exists trg_transport_drivers_scope on public.transport_drivers;
create trigger trg_transport_drivers_scope before insert or update on public.transport_drivers for each row execute function public.transport_stamp_scope();
drop trigger if exists trg_transport_trips_scope on public.transport_trips;
create trigger trg_transport_trips_scope before insert or update on public.transport_trips for each row execute function public.transport_stamp_scope();

create or replace function public.transport_expense_stamp_scope()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_company uuid; v_unit uuid;
begin
  select t.company_id,t.business_unit_id into v_company,v_unit from public.transport_trips t where t.id=new.trip_id;
  if v_company is null then raise exception 'Transport trip not found.'; end if;
  new.company_id:=v_company; new.business_unit_id:=v_unit; new.created_by:=coalesce(new.created_by,auth.uid());
  if v_company is distinct from public.current_company_id() or v_unit is distinct from public.current_business_unit_id() then
    raise exception 'Transport expense must belong to the active company and business unit.';
  end if;
  return new;
end$$;
revoke all on function public.transport_expense_stamp_scope() from public,anon,authenticated;
drop trigger if exists trg_transport_trip_expenses_scope on public.transport_trip_expenses;
create trigger trg_transport_trip_expenses_scope before insert or update on public.transport_trip_expenses for each row execute function public.transport_expense_stamp_scope();

alter table public.transport_vehicles enable row level security;
alter table public.transport_drivers enable row level security;
alter table public.transport_trips enable row level security;
alter table public.transport_trip_expenses enable row level security;

do $$
declare tbl text;
begin
  foreach tbl in array array['transport_vehicles','transport_drivers','transport_trips','transport_trip_expenses']
  loop
    execute format('drop policy if exists %I on public.%I',tbl||'_read',tbl);
    execute format('create policy %I on public.%I for select to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,''transport'',''view''))',tbl||'_read',tbl);
    execute format('drop policy if exists %I on public.%I',tbl||'_insert',tbl);
    execute format('create policy %I on public.%I for insert to authenticated with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,''transport'',''create''))',tbl||'_insert',tbl);
    execute format('drop policy if exists %I on public.%I',tbl||'_update',tbl);
    execute format('create policy %I on public.%I for update to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,''transport'',''edit'')) with check (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id())',tbl||'_update',tbl);
    execute format('drop policy if exists %I on public.%I',tbl||'_delete',tbl);
    execute format('create policy %I on public.%I for delete to authenticated using (company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and public.has_module_permission(company_id,''transport'',''delete''))',tbl||'_delete',tbl);
  end loop;
end$$;

revoke all on public.transport_vehicles,public.transport_drivers,public.transport_trips,public.transport_trip_expenses from public,anon;
grant select,insert,update,delete on public.transport_vehicles,public.transport_drivers,public.transport_trips,public.transport_trip_expenses to authenticated;

create or replace view public.transport_trip_register
with (security_invoker=true) as
select t.id,t.company_id,t.business_unit_id,t.trip_no,t.trip_date,t.status,t.ppr_status,t.po_do_job_no,
       coalesce(c.name,t.customer_name_snapshot) customer_name,
       v.vehicle_no,coalesce(t.truck_type,v.truck_type) truck_type,
       d.driver_name,coalesce(v.owner_name,t.owner_name_snapshot) owner_name,
       t.from_location,t.to_location,t.service_period,t.customer_rate,t.driver_pay,t.owner_rent,t.fuel_cost,t.toll_cost,t.other_cost,
       coalesce(e.expense_total,0)::numeric(18,2) extra_expenses,
       (t.driver_pay+t.owner_rent+t.fuel_cost+t.toll_cost+t.other_cost+coalesce(e.expense_total,0))::numeric(18,2) total_cost,
       (t.customer_rate-(t.driver_pay+t.owner_rent+t.fuel_cost+t.toll_cost+t.other_cost+coalesce(e.expense_total,0)))::numeric(18,2) trip_profit,
       t.sales_order_id,t.notes,t.created_at,t.updated_at
from public.transport_trips t
left join public.customers c on c.id=t.customer_id
left join public.transport_vehicles v on v.id=t.vehicle_id
left join public.transport_drivers d on d.id=t.driver_id
left join (select trip_id,sum(amount) expense_total from public.transport_trip_expenses group by trip_id) e on e.trip_id=t.id;
revoke all on public.transport_trip_register from public,anon;
grant select on public.transport_trip_register to authenticated;
