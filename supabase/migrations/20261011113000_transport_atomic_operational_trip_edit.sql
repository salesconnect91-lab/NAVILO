-- Atomically combine a Trip's assignment replacement with its operational edit.
-- Finalized commercial dimensions, posted evidence, existing permissions,
-- vehicle ownership history and audited assignment replacement remain protected.
create or replace function public.transport_save_operational_trip_edit(
  p_trip_id uuid,p_changes jsonb,p_vehicle_id uuid,p_driver_id uuid,p_reason text default null
) returns uuid language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare
  t public.transport_trips%rowtype;
  target_type uuid;
  type_changed boolean;
  assignment_changed boolean;
begin
  select * into t from public.transport_trips
   where id=p_trip_id and company_id=public.current_company_id()
     and business_unit_id=public.current_business_unit_id() for update;
  if not found then raise exception 'Trip not found in active workspace';end if;
  if not public.has_module_permission(t.company_id,'transport','edit')
   or not public.has_transport_action_permission(t.company_id,'trip_edit')
   then raise exception 'Trip edit permission required';end if;
  if jsonb_typeof(p_changes) is distinct from 'object'
   or octet_length(p_changes::text)>20000 then raise exception 'Invalid Trip changes';end if;
  target_type:=case when p_changes ? 'truck_type_id'
    then nullif(p_changes->>'truck_type_id','')::uuid else t.truck_type_id end;
  type_changed:=target_type is distinct from t.truck_type_id;
  assignment_changed:=(p_vehicle_id,p_driver_id) is distinct from (t.vehicle_id,t.driver_id);
  if type_changed and t.customer_rate_state='finalized' then
    raise exception 'Finalized Customer Rate locks Truck Type. Use controlled rate correction/re-finalization before changing Truck Type or Plate.';end if;
  if p_vehicle_id is not null and target_type is not null
    and not exists(select 1 from public.transport_vehicles v
      where v.id=p_vehicle_id and v.company_id=t.company_id and v.business_unit_id=t.business_unit_id
        and v.is_active and v.truck_type_id=target_type) then
    raise exception 'Selected Plate does not match the selected Trip Truck Type. Choose a compatible Vehicle.';end if;
  if type_changed and assignment_changed then
    if t.customer_rate_state is distinct from 'pending' then
      raise exception 'Truck Type correction requires a pending Customer Rate';end if;
    if target_type is not null and not exists(select 1 from public.transport_truck_types
      where id=target_type and company_id=t.company_id and business_unit_id=t.business_unit_id and is_active)
    then raise exception 'Active same-workspace Truck Type required';end if;
    -- Synchronize the intended type for the existing assignment guard.
    -- All actions are in this same transaction, and roll back together on failure.
    insert into public.transport_action_gate(transaction_id,trip_id,action)
      values(txid_current(),p_trip_id,'operational_correction');
    update public.transport_trips set truck_type_id=target_type where id=p_trip_id;
    delete from public.transport_action_gate
      where transaction_id=txid_current() and trip_id=p_trip_id and action='operational_correction';
  end if;
  if assignment_changed then
    perform public.transport_replace_trip_assignment(p_trip_id,p_vehicle_id,p_driver_id,p_reason);
  end if;
  perform public.transport_update_operational_trip(p_trip_id,p_changes);
  return p_trip_id;
end $function$;
revoke all on function public.transport_save_operational_trip_edit(uuid,jsonb,uuid,uuid,text) from public,anon;
grant execute on function public.transport_save_operational_trip_edit(uuid,jsonb,uuid,uuid,text) to authenticated;
