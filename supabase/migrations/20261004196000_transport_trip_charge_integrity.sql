create unique index if not exists transport_trip_customer_charges_trip_type_uidx
on public.transport_trip_customer_charges(trip_id,charge_type_id);

create or replace function public.transport_trip_customer_charge_input_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.amount<0 then raise exception 'Charge amount cannot be negative'; end if;
 if not exists(select 1 from public.transport_trips t where t.id=new.trip_id and t.company_id=new.company_id and t.business_unit_id=new.business_unit_id)
 then raise exception 'Charge Trip scope mismatch'; end if;
 if not exists(select 1 from public.transport_charge_types c where c.id=new.charge_type_id and c.company_id=new.company_id and c.business_unit_id=new.business_unit_id)
 then raise exception 'Charge Type outside Trip workspace'; end if;
 return new;
end $$;
drop trigger if exists transport_trip_customer_charge_input_guard on public.transport_trip_customer_charges;
create trigger transport_trip_customer_charge_input_guard before insert or update on public.transport_trip_customer_charges
for each row execute function public.transport_trip_customer_charge_input_guard();
revoke all on function public.transport_trip_customer_charge_input_guard() from public,anon,authenticated;
grant execute on function public.transport_trip_customer_charge_input_guard() to service_role;