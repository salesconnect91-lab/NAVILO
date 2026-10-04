create or replace function public.transport_finalized_commercial_dimension_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE'
    and old.customer_rate_state='finalized'
    and (new.trip_date,new.customer_id,new.truck_type_id,new.from_location_id,new.to_location_id)
        is distinct from
        (old.trip_date,old.customer_id,old.truck_type_id,old.from_location_id,old.to_location_id)
    and not exists(select 1 from public.transport_action_gate
      where transaction_id=txid_current() and trip_id=new.id and action='customer_rate_finalize')
 then
   raise exception 'Finalized Customer Rate is tied to Trip Date, Customer, Truck Type and Route. Re-finalize/override the Customer Rate before changing commercial dimensions.';
 end if;
 return new;
end $$;

drop trigger if exists transport_finalized_commercial_dimension_guard on public.transport_trips;
create trigger transport_finalized_commercial_dimension_guard
before update on public.transport_trips
for each row execute function public.transport_finalized_commercial_dimension_guard();

revoke all on function public.transport_finalized_commercial_dimension_guard() from public,anon,authenticated;
grant execute on function public.transport_finalized_commercial_dimension_guard() to service_role;