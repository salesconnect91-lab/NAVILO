create or replace function public.transport_save_operational_trip_edit(
  p_trip_id uuid,p_changes jsonb,p_vehicle_id uuid,p_driver_id uuid,p_reason text default null
) returns uuid language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare
  t public.transport_trips%rowtype;
  target_type uuid;
  type_changed boolean;
  assignment_changed boolean;
  commercial_changed boolean;
  customer_posted boolean;
  supplier_posted boolean;
  why text:=nullif(btrim(p_reason),'');
  work jsonb;
  new_base numeric; old_base numeric; has_base boolean;
  new_rent numeric; rent_id uuid; rent_count int;
  new_driver_pay numeric; has_driver_pay boolean;
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
  work:=p_changes-'customer_base_rate'-'supplier_base_rent'-'supplier_rent_id'-'driver_pay';
  has_base:=p_changes ? 'customer_base_rate' and p_changes->>'customer_base_rate' is not null;
  if has_base then new_base:=(p_changes->>'customer_base_rate')::numeric;end if;
  old_base:=coalesce(t.customer_base_rate,t.customer_rate);
  if p_changes ? 'supplier_base_rent' and p_changes->>'supplier_base_rent' is not null
   then new_rent:=(p_changes->>'supplier_base_rent')::numeric;end if;
  rent_id:=nullif(p_changes->>'supplier_rent_id','')::uuid;
  has_driver_pay:=p_changes ? 'driver_pay' and p_changes->>'driver_pay' is not null;
  if has_driver_pay then new_driver_pay:=(p_changes->>'driver_pay')::numeric;end if;
  if (new_base is not null and (new_base<0 or round(new_base,2)<>new_base))
   or (new_rent is not null and (new_rent<0 or round(new_rent,2)<>new_rent))
   or (new_driver_pay is not null and (new_driver_pay<0 or round(new_driver_pay,2)<>new_driver_pay))
   then raise exception 'Rates must be nonnegative with at most two decimals';end if;
  target_type:=case when work ? 'truck_type_id'
    then nullif(work->>'truck_type_id','')::uuid else t.truck_type_id end;
  type_changed:=target_type is distinct from t.truck_type_id;
  assignment_changed:=(p_vehicle_id,p_driver_id) is distinct from (t.vehicle_id,t.driver_id);
  commercial_changed:=type_changed
   or (work ? 'trip_date' and (work->>'trip_date')::date is distinct from t.trip_date)
   or (work ? 'customer_id' and (work->>'customer_id')::uuid is distinct from t.customer_id)
   or (work ? 'from_location' and work->>'from_location' is distinct from t.from_location)
   or (work ? 'to_location' and work->>'to_location' is distinct from t.to_location);
  select count(*) into rent_count from public.transport_trip_supplier_rents where trip_id=t.id;
  if new_rent is not null and rent_count>1 then raise exception 'Multiple supplier rents: edit each supplier separately';end if;
  if rent_id is not null and not exists(select 1 from public.transport_trip_supplier_rents
     where id=rent_id and trip_id=t.id and company_id=t.company_id and business_unit_id=t.business_unit_id)
   then raise exception 'Supplier rent must belong to the active Trip';end if;
  customer_posted:=public.transport_customer_side_posted(t.id);
  supplier_posted:=exists(select 1 from public.transport_supplier_document_rents
    where trip_id=t.id and not is_adjustment);
  if customer_posted or supplier_posted then
    if assignment_changed or commercial_changed or new_rent is not null
      or (has_base and new_base is distinct from old_base)
      or (has_driver_pay and new_driver_pay is distinct from t.driver_pay)
      or exists(select 1 from jsonb_object_keys(work) as k(key) where k.key not in
         ('ppr_status','ppr_received_date','ppr_received_by_employee_id','ppr_attachment_path','notes'))
    then raise exception 'Posted Trip is locked except PPR and Remarks. Use controlled reversal/correction.';end if;
  end if;
  if (assignment_changed or commercial_changed
      or (has_base and new_base is distinct from old_base)
      or (has_driver_pay and new_driver_pay is distinct from t.driver_pay)
      or (new_rent is not null and rent_count=0)) and why is null
    then raise exception 'Audit correction reason required';end if;
  if commercial_changed and t.customer_rate_state='finalized' then
    if not public.has_transport_action_permission(t.company_id,'customer_rate_override')
       then raise exception 'Customer Rate Override permission required for commercial correction';end if;
    insert into public.transport_action_gate(transaction_id,trip_id,action)
      values(txid_current(),t.id,'customer_rate_finalize') on conflict do nothing;
  end if;
  if p_vehicle_id is not null and target_type is not null
    and not exists(select 1 from public.transport_vehicles v
      where v.id=p_vehicle_id and v.company_id=t.company_id and v.business_unit_id=t.business_unit_id
        and v.is_active and v.truck_type_id=target_type) then
    raise exception 'Selected Plate does not match the selected Trip Truck Type. Choose a compatible Vehicle.';end if;
  if type_changed and assignment_changed then
    -- An authorized, audited finalized rate can be re-confirmed before posting.
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
  if work ? 'trip_date' and (work->>'trip_date')::date is distinct from t.trip_date then
    work:=work||jsonb_build_object('correction_reason',why);
  end if;
  perform public.transport_update_operational_trip(p_trip_id,work);
  if commercial_changed and t.customer_rate_state='finalized' then
    delete from public.transport_action_gate where transaction_id=txid_current()
      and trip_id=t.id and action='customer_rate_finalize';
  end if;
  if (has_base and new_base is distinct from old_base)
   or (commercial_changed and t.customer_rate_state='finalized') then
    perform public.transport_finalize_customer_rate(t.id,coalesce(new_base,old_base),'manual',why);
  end if;
  if new_rent is not null and (rent_id is not null or new_rent>0) then
    if rent_id is null then
      if rent_count>0 then raise exception 'Select the supplier rent line to edit';end if;
      if (select owner_supplier_id from public.transport_trips where id=t.id) is null
      then raise exception 'Supplier Rent requires a supplier-owned Plate';end if;
      rent_id:=public.transport_add_supplier_rent(t.id,
       (select owner_supplier_id from public.transport_trips where id=t.id),new_rent,why);
    end if;
    if new_rent is distinct from (select base_amount from public.transport_trip_supplier_rents where id=rent_id)
       or exists(select 1 from public.transport_trip_supplier_rents where id=rent_id and state='pending')
    then perform public.transport_finalize_supplier_rent(rent_id,new_rent,why);end if;
  end if;
  if has_driver_pay and new_driver_pay is distinct from t.driver_pay then
    perform public.transport_finance_assert('driver');
    update public.transport_trips set driver_pay=new_driver_pay where id=t.id;
    insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
    values(t.company_id,t.business_unit_id,t.id,t.trip_no,'driver_pay_correct',to_jsonb(t.driver_pay),to_jsonb(new_driver_pay),why,auth.uid());
  end if;
  if commercial_changed then
    update public.transport_trips set customer_rate_reference_id=null,
      customer_rate_source=case when customer_rate_state='finalized' then 'manual' else customer_rate_source end where id=t.id;
    insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
    values(t.company_id,t.business_unit_id,t.id,t.trip_no,'pre_post_commercial_edit',
      jsonb_build_object('date',t.trip_date,'customer',t.customer_id,'type',t.truck_type_id,'from',t.from_location,'to',t.to_location),
      (select jsonb_build_object('date',trip_date,'customer',customer_id,'type',truck_type_id,'from',from_location,'to',to_location) from public.transport_trips where id=t.id),
      why,auth.uid());
  end if;
  return p_trip_id;
end $function$;

revoke all on function public.transport_save_operational_trip_edit(uuid,jsonb,uuid,uuid,text) from public,anon;
grant execute on function public.transport_save_operational_trip_edit(uuid,jsonb,uuid,uuid,text) to authenticated;
