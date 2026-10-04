begin;

-- Preserve every historical Trip/assignment reference. Resolve the legacy duplicate
-- physical plate only at the master-selection layer.
do $$
declare
  legacy_id uuid := 'cb9ad0cf-366d-4a75-8577-0ac1b3a455a8';
  current_id uuid := '302cac0f-7655-4ea6-b00f-4652b35dce6d';
  c uuid := '38054e27-ceb6-485e-8001-4f2bfd6ff0d1';
  b uuid := 'c66aedd1-3bf6-475b-a502-1bc9b5316383';
begin
  if (select count(*) from public.transport_vehicles
      where company_id=c and business_unit_id=b
        and public.transport_master_normalized_key(vehicle_no)=public.transport_master_normalized_key('5731')) <> 2 then
    raise exception 'Audited Vehicle 5731 duplicate group changed; refusing reconciliation';
  end if;

  if not exists(select 1 from public.transport_vehicles where id=legacy_id and company_id=c and business_unit_id=b and vehicle_no='5731')
     or not exists(select 1 from public.transport_vehicles where id=current_id and company_id=c and business_unit_id=b and vehicle_no='5731') then
    raise exception 'Audited Vehicle 5731 identities changed; refusing reconciliation';
  end if;

  -- Do not rewrite Trips, assignments, accounting provenance, or ownership history.
  -- Give the historical duplicate a non-colliding archival identity and deactivate it,
  -- leaving the operational master as the sole selectable 5731.
  update public.transport_vehicles
     set vehicle_no='5731 (Legacy)', is_active=false
   where id=legacy_id;

  if not exists(select 1 from public.transport_vehicles where id=current_id and vehicle_no='5731' and is_active) then
    raise exception 'Current Vehicle 5731 is not active after reconciliation';
  end if;
end
$$;

-- Now that the active/current plate identity is unique, enforce normalized identity
-- for every future Vehicle insert/update in addition to the existing trigger guard.
create unique index if not exists transport_vehicles_plate_identity_uidx
  on public.transport_vehicles(company_id,business_unit_id,(public.transport_master_normalized_key(vehicle_no)));

commit;
