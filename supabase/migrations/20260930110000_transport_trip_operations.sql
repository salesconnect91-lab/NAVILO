-- NAVILO Transport V1 finalized trip operations
-- Forward-only additive migration.
-- No accounting posting functions are changed.

-- PPR receiver is the authenticated NAVILO user, not an Employee record.
alter table public.transport_trips
  drop constraint if exists transport_trips_ppr_received_by_fkey;

alter table public.transport_trips
  add constraint transport_trips_ppr_received_by_fkey
  foreign key (ppr_received_by)
  references auth.users(id)
  on delete restrict;

-- Ordered route/location history for each Trip.
create table if not exists public.transport_trip_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  business_unit_id uuid not null references public.business_units(id) on delete cascade,
  trip_id uuid not null references public.transport_trips(id) on delete restrict,
  location_id uuid references public.transport_locations(id) on delete restrict,
  location_name_snapshot text not null,
  sequence_no integer not null check (sequence_no > 0),
  event_name text,
  waiting_count integer check (waiting_count is null or waiting_count >= 0),
  is_cancelled boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(trip_id,sequence_no)
);

create index if not exists transport_trip_locations_trip_idx
  on public.transport_trip_locations(company_id,business_unit_id,trip_id,sequence_no);

alter table public.transport_trip_locations enable row level security;

drop policy if exists transport_trip_locations_read
  on public.transport_trip_locations;
create policy transport_trip_locations_read
  on public.transport_trip_locations
  for select to authenticated
  using (
    company_id=public.current_company_id()
    and business_unit_id=public.current_business_unit_id()
    and public.has_module_permission(company_id,'transport','view')
  );

drop policy if exists transport_trip_locations_insert
  on public.transport_trip_locations;
create policy transport_trip_locations_insert
  on public.transport_trip_locations
  for insert to authenticated
  with check (
    company_id=public.current_company_id()
    and business_unit_id=public.current_business_unit_id()
    and public.has_module_permission(company_id,'transport','create')
  );

drop policy if exists transport_trip_locations_update
  on public.transport_trip_locations;
create policy transport_trip_locations_update
  on public.transport_trip_locations
  for update to authenticated
  using (
    company_id=public.current_company_id()
    and business_unit_id=public.current_business_unit_id()
    and public.has_module_permission(company_id,'transport','edit')
  )
  with check (
    company_id=public.current_company_id()
    and business_unit_id=public.current_business_unit_id()
  );

grant select,insert,update on public.transport_trip_locations to authenticated;

-- Scope/stamp route changes and guarantee they belong to the same Trip scope.
create or replace function public.transport_trip_location_stamp()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_trip public.transport_trips%rowtype;
begin
  select *
    into v_trip
    from public.transport_trips
   where id=new.trip_id;

  if not found then
    raise exception 'Transport Trip not found.';
  end if;

  new.company_id:=v_trip.company_id;
  new.business_unit_id:=v_trip.business_unit_id;

  if new.company_id is distinct from public.current_company_id()
     or new.business_unit_id is distinct from public.current_business_unit_id() then
    raise exception 'Trip location must belong to the active company and business unit.';
  end if;

  if tg_op='INSERT' then
    new.created_by:=coalesce(new.created_by,auth.uid());
  end if;

  new.updated_by:=auth.uid();
  new.updated_at:=now();

  return new;
end
$$;

revoke all on function public.transport_trip_location_stamp()
  from public,anon,authenticated;

drop trigger if exists trg_transport_trip_locations_scope
  on public.transport_trip_locations;
create trigger trg_transport_trip_locations_scope
before insert or update on public.transport_trip_locations
for each row execute function public.transport_trip_location_stamp();

-- Route changes become part of the same immutable Trip audit stream.
create or replace function public.transport_trip_location_audit_capture()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  insert into public.transport_trip_audit(
    company_id,business_unit_id,trip_id,event_type,
    old_data,new_data,changed_by
  )
  values(
    coalesce(new.company_id,old.company_id),
    coalesce(new.business_unit_id,old.business_unit_id),
    coalesce(new.trip_id,old.trip_id),
    'location_'||lower(tg_op),
    case when tg_op='INSERT' then null else to_jsonb(old) end,
    case when tg_op='DELETE' then null else to_jsonb(new) end,
    auth.uid()
  );

  return coalesce(new,old);
end
$$;

revoke all on function public.transport_trip_location_audit_capture()
  from public,anon,authenticated;

drop trigger if exists trg_transport_trip_location_audit
  on public.transport_trip_locations;
create trigger trg_transport_trip_location_audit
after insert or update or delete on public.transport_trip_locations
for each row execute function public.transport_trip_location_audit_capture();

-- Business classification:
-- both required rates present => Complete
-- otherwise => Not Complete
-- Draft remains a technical lifecycle state and is not overwritten here.
create or replace function public.transport_trip_auto_classify()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if new.trip_status <> 'draft'
     and new.trip_status <> 'cancelled' then
    if new.customer_rate is not null
       and new.supplier_rent is not null then
      new.trip_status:='completed';
    else
      new.trip_status:='running';
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.transport_trip_auto_classify()
  from public,anon,authenticated;

drop trigger if exists trg_transport_trip_auto_classify
  on public.transport_trips;
create trigger trg_transport_trip_auto_classify
before insert or update of customer_rate,supplier_rent,trip_status
on public.transport_trips
for each row execute function public.transport_trip_auto_classify();

-- PPR rules.
create or replace function public.transport_trip_ppr_guard()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if new.ppr_status='received' then
    if old.ppr_status is distinct from 'received'
       or new.ppr_received_by is null then
      new.ppr_received_by:=auth.uid();
    end if;

    if new.ppr_received_date is null then
      new.ppr_received_date:=current_date;
    end if;
  elsif new.ppr_status='pending' then
    new.ppr_received_by:=null;
    new.ppr_received_date:=null;
    new.ppr_attachment_path:=null;
  end if;

  return new;
end
$$;

revoke all on function public.transport_trip_ppr_guard()
  from public,anon,authenticated;

drop trigger if exists trg_transport_trip_ppr_guard
  on public.transport_trips;
create trigger trg_transport_trip_ppr_guard
before insert or update of ppr_status,ppr_received_by,ppr_received_date,ppr_attachment_path
on public.transport_trips
for each row execute function public.transport_trip_ppr_guard();

-- Existing from_location / to_location remain intact for compatibility.
-- No historical Trip is rewritten by this migration.
