-- Forward-only compatibility guard for canonical NAVILO Charge Master on Transport customer charges.
-- Preserves legacy charge_type_id rows while allowing canonical charge_master_id rows.

create or replace function public.transport_trip_customer_charge_input_guard()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_trip public.transport_trips%rowtype;
  v_master public.charge_master%rowtype;
begin
  select * into v_trip
  from public.transport_trips
  where id = new.trip_id;

  if not found
     or v_trip.company_id is distinct from new.company_id
     or v_trip.business_unit_id is distinct from new.business_unit_id then
    raise exception 'Customer charge outside Trip workspace';
  end if;

  if coalesce(new.amount,0) < 0 then
    raise exception 'Charge amount cannot be negative';
  end if;

  if new.charge_master_id is not null then
    select * into v_master
    from public.charge_master
    where id = new.charge_master_id
      and company_id = new.company_id
      and is_active
      and applies_to in ('sales','both');

    if not found then
      raise exception 'Selected Charge Master item is not active for Sales';
    end if;

    if v_master.revenue_account_id is null then
      raise exception 'Charge % has no revenue account mapping', v_master.charge_name;
    end if;

    new.charge_type_id := null;
    new.code_snapshot := coalesce(nullif(btrim(new.code_snapshot),''), v_master.charge_key);
    new.name_snapshot := coalesce(nullif(btrim(new.name_snapshot),''), v_master.charge_name);
    return new;
  end if;

  if new.charge_type_id is null
     or not exists (
       select 1
       from public.transport_charge_types c
       where c.id = new.charge_type_id
         and c.company_id = new.company_id
         and c.business_unit_id = new.business_unit_id
     ) then
    raise exception 'Charge Type outside Trip workspace';
  end if;

  return new;
end
$$;

drop trigger if exists transport_trip_customer_charge_input_guard
on public.transport_trip_customer_charges;

create trigger transport_trip_customer_charge_input_guard
before insert or update on public.transport_trip_customer_charges
for each row execute function public.transport_trip_customer_charge_input_guard();

revoke all on function public.transport_trip_customer_charge_input_guard() from public,anon,authenticated;
grant execute on function public.transport_trip_customer_charge_input_guard() to service_role;
