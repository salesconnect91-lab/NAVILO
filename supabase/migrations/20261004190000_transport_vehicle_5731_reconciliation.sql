begin;

-- Reconcile the one known legacy duplicate physical plate left intentionally
-- untouched by 20261002130000_transport_vehicle_plate_identity.sql.
-- Fail closed if the live evidence no longer matches the audited shape.
do $$
declare
  canonical_id uuid := '302cac0f-7655-4ea6-b00f-4652b35dce6d';
  duplicate_id uuid := 'cb9ad0cf-366d-4a75-8577-0ac1b3a455a8';
  c uuid;
  b uuid;
begin
  select company_id,business_unit_id into c,b
  from public.transport_vehicles
  where id=canonical_id
    and public.transport_master_normalized_key(vehicle_no)=public.transport_master_normalized_key('5731');

  if c is null or b is null then
    raise exception 'Audited canonical Vehicle 5731 is missing; refusing reconciliation';
  end if;

  if not exists(
    select 1 from public.transport_vehicles
    where id=duplicate_id and company_id=c and business_unit_id=b
      and public.transport_master_normalized_key(vehicle_no)=public.transport_master_normalized_key('5731')
  ) then
    raise exception 'Audited duplicate Vehicle 5731 is missing or changed; refusing reconciliation';
  end if;

  if (select count(*) from public.transport_vehicles
      where company_id=c and business_unit_id=b
        and public.transport_master_normalized_key(vehicle_no)=public.transport_master_normalized_key('5731')) <> 2 then
    raise exception 'Vehicle 5731 duplicate group no longer has exactly two rows; refusing reconciliation';
  end if;

  -- Preserve historical Trips while making the physical Vehicle identity canonical.
  update public.transport_trips
     set vehicle_id=canonical_id
   where company_id=c and business_unit_id=b and vehicle_id=duplicate_id;

  -- Assignment history is accounting/report provenance. Keep every assignment row,
  -- only repoint its Vehicle identity; snapshots remain historical evidence.
  update public.transport_trip_assignments
     set vehicle_id=canonical_id
   where company_id=c and business_unit_id=b and vehicle_id=duplicate_id;

  -- The duplicate master carried only the same 02-Oct onward GONDAL period already
  -- present on the canonical Vehicle. Delete only exact duplicate ownership evidence.
  delete from public.transport_vehicle_ownership d
   where d.vehicle_id=duplicate_id
     and exists(
       select 1 from public.transport_vehicle_ownership k
       where k.vehicle_id=canonical_id
         and k.company_id=d.company_id and k.business_unit_id=d.business_unit_id
         and k.owner_type=d.owner_type
         and k.supplier_id is not distinct from d.supplier_id
         and k.owner_name_snapshot is not distinct from d.owner_name_snapshot
         and k.effective_from=d.effective_from
         and k.effective_to is not distinct from d.effective_to
     );

  if exists(select 1 from public.transport_vehicle_ownership where vehicle_id=duplicate_id) then
    raise exception 'Duplicate Vehicle 5731 still has non-duplicate ownership evidence; refusing deletion';
  end if;

  if exists(select 1 from public.transport_trips where vehicle_id=duplicate_id)
     or exists(select 1 from public.transport_trip_assignments where vehicle_id=duplicate_id) then
    raise exception 'Duplicate Vehicle 5731 still has references; refusing deletion';
  end if;

  delete from public.transport_vehicles where id=duplicate_id;

  if not exists(select 1 from public.transport_vehicles where id=canonical_id) then
    raise exception 'Canonical Vehicle 5731 disappeared unexpectedly';
  end if;
end
$$;

-- The earlier plate-identity migration creates this only on clean databases.
-- After reconciliation, enforce physical plate identity at the database layer.
create unique index if not exists transport_vehicles_plate_identity_uidx
  on public.transport_vehicles(company_id,business_unit_id,(public.transport_master_normalized_key(vehicle_no)));

commit;
