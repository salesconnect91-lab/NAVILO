begin;

-- A physical plate is one Vehicle Master inside a Company + Business Unit.
-- Legacy duplicate rows are intentionally NOT merged here because they may already
-- be referenced by Trips / assignments / ownership history.
create or replace function public.transport_vehicle_plate_identity_guard()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  normalized_plate text;
begin
  normalized_plate:=public.transport_master_normalized_key(new.vehicle_no);
  if normalized_plate is null or normalized_plate='' then
    raise exception 'Vehicle number / plate is required';
  end if;

  if tg_op='INSERT'
     or public.transport_master_normalized_key(new.vehicle_no)
        is distinct from public.transport_master_normalized_key(old.vehicle_no) then
    perform pg_advisory_xact_lock(
      hashtextextended(
        'transport-vehicle-plate:'||new.company_id::text||':'||new.business_unit_id::text||':'||normalized_plate,
        0
      )
    );

    if exists(
      select 1
      from public.transport_vehicles v
      where v.company_id=new.company_id
        and v.business_unit_id=new.business_unit_id
        and v.id<>new.id
        and public.transport_master_normalized_key(v.vehicle_no)=normalized_plate
    ) then
      raise exception 'Vehicle % already exists in this company/business unit. Change ownership through Vehicle Ownership History instead of creating another Vehicle.',btrim(new.vehicle_no);
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.transport_vehicle_plate_identity_guard() from public,anon,authenticated;

drop trigger if exists zzzz_transport_vehicle_plate_identity_guard on public.transport_vehicles;
create trigger zzzz_transport_vehicle_plate_identity_guard
before insert or update of vehicle_no on public.transport_vehicles
for each row execute function public.transport_vehicle_plate_identity_guard();

-- Fresh databases get a physical unique index too. A live database containing
-- historical duplicates is left untouched until those references are reconciled.
do $$
begin
  if not exists(
    select 1
    from public.transport_vehicles
    group by company_id,business_unit_id,public.transport_master_normalized_key(vehicle_no)
    having count(*)>1
  ) then
    create unique index if not exists transport_vehicles_plate_identity_uidx
      on public.transport_vehicles(company_id,business_unit_id,(public.transport_master_normalized_key(vehicle_no)));
  end if;
end
$$;

commit;
