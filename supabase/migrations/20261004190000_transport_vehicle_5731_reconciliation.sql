begin;

-- One-time reconciliation of the audited legacy duplicate plate 5731.
-- Historical Trips, assignments, accounting provenance and ownership history remain untouched.
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

  if not exists(select 1 from public.transport_vehicles where id=legacy_id and company_id=c and business_unit_id=b and vehicle_no='5731' and is_active)
     or not exists(select 1 from public.transport_vehicles where id=current_id and company_id=c and business_unit_id=b and vehicle_no='5731' and is_active) then
    raise exception 'Audited Vehicle 5731 identities changed; refusing reconciliation';
  end if;

  -- These two normal application guards require an authenticated active workspace.
  -- Disable them only for this exact migration update; PostgreSQL transaction rollback
  -- restores trigger state automatically if any later assertion fails.
  alter table public.transport_vehicles disable trigger trg_transport_vehicles_scope;
  alter table public.transport_vehicles disable trigger zzz_transport_master_data_guard;

  update public.transport_vehicles
     set vehicle_no='5731 (Legacy)', is_active=false
   where id=legacy_id and company_id=c and business_unit_id=b and vehicle_no='5731';

  alter table public.transport_vehicles enable trigger zzz_transport_master_data_guard;
  alter table public.transport_vehicles enable trigger trg_transport_vehicles_scope;

  if not exists(select 1 from public.transport_vehicles where id=legacy_id and vehicle_no='5731 (Legacy)' and not is_active)
     or not exists(select 1 from public.transport_vehicles where id=current_id and vehicle_no='5731' and is_active) then
    raise exception 'Vehicle 5731 reconciliation postcondition failed';
  end if;
end
$$;

create unique index if not exists transport_vehicles_plate_identity_uidx
  on public.transport_vehicles(company_id,business_unit_id,(public.transport_master_normalized_key(vehicle_no)));

commit;
