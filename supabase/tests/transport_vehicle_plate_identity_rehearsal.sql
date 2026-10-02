begin;

do $$
declare
  c uuid;
  b uuid;
  existing_plate text;
  duplicate_blocked boolean:=false;
begin
  select company_id,business_unit_id,vehicle_no
    into c,b,existing_plate
  from public.transport_vehicles
  where nullif(btrim(vehicle_no),'') is not null
  limit 1;

  if c is null then
    raise notice 'SKIP: no Transport vehicle fixture available';
    return;
  end if;

  begin
    insert into public.transport_vehicles(company_id,business_unit_id,vehicle_no)
    values(c,b,'  '||upper(existing_plate)||'  ');
  exception when others then
    duplicate_blocked:=position('already exists in this company/business unit' in sqlerrm)>0
      or position('Duplicate master name / vehicle number' in sqlerrm)>0
      or sqlstate='23505';
  end;

  if not duplicate_blocked then
    raise exception 'FAIL: duplicate normalized vehicle plate was accepted';
  end if;

  raise notice 'PASS: duplicate normalized vehicle plate is blocked';
end
$$;

rollback;
