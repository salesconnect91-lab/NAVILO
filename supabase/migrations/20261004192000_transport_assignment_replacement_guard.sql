create or replace function public.transport_replace_trip_assignment(p_trip_id uuid,p_vehicle_id uuid,p_driver_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype;v public.transport_vehicles%rowtype;d public.transport_drivers%rowtype;o public.transport_vehicle_ownership%rowtype;v_replaced_at timestamptz;
begin
 select * into t from public.transport_trips where id=p_trip_id for update;
 if not found or t.company_id is distinct from public.current_company_id() or t.business_unit_id is distinct from public.current_business_unit_id() then raise exception 'Transport Trip not found';end if;
 if not public.has_transport_action_permission(t.company_id,'assignment_replace') or nullif(btrim(p_reason),'') is null then raise exception 'Replacement permission and reason required';end if;
 if (p_vehicle_id,p_driver_id) is not distinct from (t.vehicle_id,t.driver_id) then raise exception 'Assignment did not change';end if;
 if p_vehicle_id is not null then
  select * into v from public.transport_vehicles where id=p_vehicle_id and company_id=t.company_id and business_unit_id=t.business_unit_id and is_active;
  if not found then raise exception 'Active vehicle not found in workspace';end if;
  if t.truck_type_id is not null and v.truck_type_id is distinct from t.truck_type_id then raise exception 'Replacement Vehicle does not match Trip Truck Type';end if;
  select * into o from public.transport_vehicle_ownership where vehicle_id=p_vehicle_id and company_id=t.company_id and business_unit_id=t.business_unit_id and effective_from<=t.trip_date and (effective_to is null or effective_to>=t.trip_date) order by effective_from desc,id limit 1;
  if not found then raise exception 'Replacement Vehicle Ownership History must cover Trip Date';end if;
  if o.owner_type='third_party' and not exists(select 1 from public.suppliers where id=o.supplier_id and company_id=t.company_id and is_active) then raise exception 'Replacement Vehicle Owner / Supplier must be active in the same Company';end if;
 end if;
 if p_driver_id is not null then
  select * into d from public.transport_drivers where id=p_driver_id and company_id=t.company_id and business_unit_id=t.business_unit_id and is_active;
  if not found then raise exception 'Active driver not found in workspace';end if;
  if d.driver_type='supplier' and not exists(select 1 from public.suppliers where id=d.supplier_id and company_id=t.company_id and is_active) then raise exception 'Replacement Driver Supplier must be active in the same Company';end if;
 end if;
 insert into public.transport_action_gate values(txid_current(),t.id,'assignment_replace');
 v_replaced_at:=clock_timestamp();
 update public.transport_trip_assignments set ended_at=greatest(v_replaced_at,effective_at+interval '1 microsecond') where trip_id=t.id and ended_at is null;
 select coalesce((select ended_at from public.transport_trip_assignments where trip_id=t.id and ended_at is not null order by ended_at desc limit 1),v_replaced_at) into v_replaced_at;
 insert into public.transport_trip_assignments(company_id,business_unit_id,trip_id,vehicle_id,driver_id,vehicle_no_snapshot,driver_name_snapshot,owner_name_snapshot,effective_at,reason,actor_id)
 values(t.company_id,t.business_unit_id,t.id,p_vehicle_id,p_driver_id,v.vehicle_no,d.driver_name,coalesce(o.owner_name_snapshot,v.owner_name),v_replaced_at,p_reason,auth.uid());
 update public.transport_trips set vehicle_id=p_vehicle_id,driver_id=p_driver_id,ownership_id=o.id,owner_supplier_id=o.supplier_id,owner_name_snapshot=coalesce(o.owner_name_snapshot,v.owner_name) where id=t.id;
 delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=t.id and action='assignment_replace';
 insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
 values(t.company_id,t.business_unit_id,t.id,t.trip_no,'assignment_replace',jsonb_build_object('vehicle_id',t.vehicle_id,'driver_id',t.driver_id),jsonb_build_object('vehicle_id',p_vehicle_id,'driver_id',p_driver_id),p_reason,auth.uid());
end $$;