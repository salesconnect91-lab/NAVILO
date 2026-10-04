create or replace function public.transport_update_operational_trip(p_trip_id uuid,p_changes jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype;r public.transport_trips%rowtype;k text;
 allowed text[]:=array['trip_date','customer_id','customer_name_snapshot','truck_type_id','from_location','to_location','po_do_job_no','ppr_status','ppr_received_date','ppr_received_by_employee_id','ppr_attachment_path','sale_type','notes','correction_reason'];
 from_place public.transport_locations%rowtype;to_place public.transport_locations%rowtype;own public.transport_vehicle_ownership%rowtype;reason text;
begin
 if not public.has_module_permission(public.current_company_id(),'transport','edit') or not public.has_transport_action_permission(public.current_company_id(),'trip_edit') then raise exception 'Trip edit permission required';end if;
 if jsonb_typeof(p_changes) is distinct from 'object' or octet_length(p_changes::text)>20000 then raise exception 'Invalid Trip changes';end if;
 for k in select jsonb_object_keys(p_changes) loop if not k=any(allowed) then raise exception 'Unsupported operational field %',k;end if;end loop;
 select * into t from public.transport_trips where id=p_trip_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() for update;
 if not found then raise exception 'Trip not found in workspace';end if;
 reason:=nullif(btrim(p_changes->>'correction_reason'),''); r:=jsonb_populate_record(t,p_changes-'correction_reason');
 if r.trip_date is null then raise exception 'Trip Date required';end if;
 if r.trip_date is distinct from t.trip_date and reason is null then raise exception 'Trip Date correction reason required';end if;
 if r.customer_id is null or not exists(select 1 from public.customers where id=r.customer_id and company_id=t.company_id and is_active) then raise exception 'Active same-company Customer required';end if;
 select * into from_place from public.transport_locations where company_id=t.company_id and business_unit_id=t.business_unit_id and is_active and public.transport_master_normalized_key(name)=public.transport_master_normalized_key(r.from_location) limit 1;
 if not found then raise exception 'Active same-workspace From Location required';end if;
 select * into to_place from public.transport_locations where company_id=t.company_id and business_unit_id=t.business_unit_id and is_active and public.transport_master_normalized_key(name)=public.transport_master_normalized_key(r.to_location) limit 1;
 if not found then raise exception 'Active same-workspace To Location required';end if;
 if r.truck_type_id is not null and not exists(select 1 from public.transport_truck_types where id=r.truck_type_id and company_id=t.company_id and business_unit_id=t.business_unit_id and is_active) then raise exception 'Active same-workspace Truck Type required';end if;
 if t.vehicle_id is not null then
  if r.truck_type_id is not null and not exists(select 1 from public.transport_vehicles where id=t.vehicle_id and company_id=t.company_id and business_unit_id=t.business_unit_id and is_active and truck_type_id=r.truck_type_id) then raise exception 'Vehicle does not match Trip Truck Type';end if;
  select * into own from public.transport_vehicle_ownership where vehicle_id=t.vehicle_id and company_id=t.company_id and business_unit_id=t.business_unit_id and effective_from<=r.trip_date and (effective_to is null or effective_to>=r.trip_date) order by effective_from desc,id limit 1;
  if not found then raise exception 'Vehicle Ownership History must cover corrected Trip Date';end if;
  if own.owner_type='third_party' and not exists(select 1 from public.suppliers where id=own.supplier_id and company_id=t.company_id and is_active) then raise exception 'Active same-company Owner / Supplier required';end if;
 end if;
 insert into public.transport_action_gate values(txid_current(),t.id,'operational_correction');
 update public.transport_trips set trip_date=r.trip_date,customer_id=r.customer_id,customer_name_snapshot=(select name from public.customers where id=r.customer_id),truck_type_id=r.truck_type_id,
  from_location_id=from_place.id,to_location_id=to_place.id,from_location=from_place.name,to_location=to_place.name,po_do_job_no=r.po_do_job_no,ppr_status=r.ppr_status,
  ppr_received_date=r.ppr_received_date,ppr_received_by_employee_id=r.ppr_received_by_employee_id,ppr_attachment_path=r.ppr_attachment_path,sale_type=r.sale_type,notes=r.notes,
  ownership_id=case when t.vehicle_id is null then null else own.id end,owner_supplier_id=case when t.vehicle_id is null then null else own.supplier_id end,
  owner_name_snapshot=case when t.vehicle_id is null then null else own.owner_name_snapshot end where id=t.id;
 delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=t.id and action='operational_correction';
 if r.trip_date is distinct from t.trip_date then
  insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
  values(t.company_id,t.business_unit_id,t.id,t.trip_no,'trip_date_correction',to_jsonb(t.trip_date),to_jsonb(r.trip_date),reason,auth.uid());
 end if;
 return t.id;
end $$;

create or replace function public.transport_trip_batch1_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_no text;v_seq bigint;v_prefix text;v_name text;v_owner public.transport_vehicle_ownership%rowtype;
begin
 if tg_op='INSERT' then
  if not public.has_transport_action_permission(new.company_id,'trip_create') then raise exception 'Trip create permission required';end if;
  insert into public.transport_trip_number_settings(company_id) values(new.company_id) on conflict do nothing;
  select prefix,next_number into v_prefix,v_seq from public.transport_trip_number_settings where company_id=new.company_id for update;
  loop v_no:=v_prefix||lpad(v_seq::text,6,'0');exit when not exists(select 1 from public.transport_trip_number_registry where company_id=new.company_id and trip_no=v_no);v_seq:=v_seq+1;end loop;
  update public.transport_trip_number_settings set next_number=v_seq+1,updated_at=now() where company_id=new.company_id;
  new.trip_no:=v_no;new.status:='draft';new.lifecycle_status:='not_complete';new.rent_state:='pending';new.customer_rate_state:='pending';
  if new.vehicle_id is not null then select * into v_owner from public.transport_vehicle_ownership where vehicle_id=new.vehicle_id and company_id=new.company_id and business_unit_id=new.business_unit_id and effective_from<=new.trip_date and (effective_to is null or effective_to>=new.trip_date) order by effective_from desc limit 1;if found then new.ownership_id:=v_owner.id;new.owner_supplier_id:=v_owner.supplier_id;new.owner_name_snapshot:=v_owner.owner_name_snapshot;end if;end if;
  insert into public.transport_trip_number_registry(company_id,business_unit_id,trip_no,sequence_no,trip_id,issued_by) values(new.company_id,new.business_unit_id,v_no,v_seq,new.id,auth.uid());
 else
  if (new.company_id,new.business_unit_id,new.trip_no) is distinct from (old.company_id,old.business_unit_id,old.trip_no) then raise exception 'Trip number and tenant scope are immutable';end if;
  if new.status is distinct from old.status then raise exception 'Legacy status cannot be set manually';end if;
  if new.trip_date is distinct from old.trip_date and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action='operational_correction') then raise exception 'Trip date correction requires controlled ownership review';end if;
  if not public.has_transport_action_permission(new.company_id,'trip_edit') and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action in ('rent_finalize','rent_correct','customer_rate_finalize','assignment_replace','operational_correction')) then raise exception 'Trip edit permission required';end if;
  if (new.lifecycle_status,new.rent_state,new.rent_finalized_at,new.rent_finalized_by) is distinct from (old.lifecycle_status,old.rent_state,old.rent_finalized_at,old.rent_finalized_by) and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action='rent_finalize') then raise exception 'Rent lifecycle requires controlled finalization';end if;
  if (new.customer_rate_state,new.customer_rate_snapshot,new.customer_rate_finalized_at,new.customer_rate_finalized_by) is distinct from (old.customer_rate_state,old.customer_rate_snapshot,old.customer_rate_finalized_at,old.customer_rate_finalized_by) and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action='customer_rate_finalize') then raise exception 'Customer rate requires controlled finalization';end if;
  if new.owner_rent is distinct from old.owner_rent and old.rent_state='finalized' and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action='rent_correct') then raise exception 'Finalized owner rent requires controlled correction';end if;
  if new.owner_rent<>0 and exists(select 1 from public.transport_trip_supplier_rents where trip_id=new.id) then raise exception 'Structured supplier rents require zero legacy owner rent';end if;
  if (new.vehicle_id,new.driver_id) is distinct from (old.vehicle_id,old.driver_id) and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action='assignment_replace') then raise exception 'Driver/vehicle replacement requires controlled action';end if;
  if (new.ownership_id,new.owner_supplier_id,new.owner_name_snapshot) is distinct from (old.ownership_id,old.owner_supplier_id,old.owner_name_snapshot) and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action in ('assignment_replace','operational_correction')) then raise exception 'Ownership snapshot requires controlled replacement';end if;
  if (new.customer_rate_source,new.customer_rate_reference_id) is distinct from (old.customer_rate_source,old.customer_rate_reference_id) and old.customer_rate_state='finalized' and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action='customer_rate_finalize') then raise exception 'Finalized rate source is immutable without override';end if;
 end if;
 if new.customer_id is not null and not exists(select 1 from public.customers where id=new.customer_id and company_id=new.company_id) then raise exception 'Customer company mismatch';end if;
 if new.vehicle_id is not null and not exists(select 1 from public.transport_vehicles where id=new.vehicle_id and company_id=new.company_id and business_unit_id=new.business_unit_id and is_active) then raise exception 'Active vehicle not found in Trip workspace';end if;
 if new.driver_id is not null and not exists(select 1 from public.transport_drivers where id=new.driver_id and company_id=new.company_id and business_unit_id=new.business_unit_id and is_active) then raise exception 'Active driver not found in Trip workspace';end if;
 if new.truck_type_id is not null and not exists(select 1 from public.transport_truck_types where id=new.truck_type_id and company_id=new.company_id and business_unit_id=new.business_unit_id and is_active) then raise exception 'Inactive or missing Truck Type';end if;
 if new.from_location_id is not null and not exists(select 1 from public.transport_locations where id=new.from_location_id and company_id=new.company_id and business_unit_id=new.business_unit_id and is_active) then raise exception 'Inactive or missing From Location';end if;
 if new.to_location_id is not null and not exists(select 1 from public.transport_locations where id=new.to_location_id and company_id=new.company_id and business_unit_id=new.business_unit_id and is_active) then raise exception 'Inactive or missing To Location';end if;
 if new.owner_supplier_id is not null and not exists(select 1 from public.suppliers where id=new.owner_supplier_id and company_id=new.company_id) then raise exception 'Owner supplier company mismatch';end if;
 if new.ownership_id is not null and not exists(select 1 from public.transport_vehicle_ownership where id=new.ownership_id and vehicle_id=new.vehicle_id and company_id=new.company_id and business_unit_id=new.business_unit_id and effective_from<=new.trip_date and (effective_to is null or effective_to>=new.trip_date)) then raise exception 'Vehicle ownership does not cover Trip date';end if;
 if new.ppr_status='received' then
  if (tg_op='INSERT' or (new.ppr_status,new.ppr_received_by_employee_id,new.ppr_received_date,new.ppr_attachment_path) is distinct from (old.ppr_status,old.ppr_received_by_employee_id,old.ppr_received_date,old.ppr_attachment_path)) and not public.has_transport_action_permission(new.company_id,'ppr_receive') then raise exception 'PPR receipt permission required';end if;
  if tg_op='INSERT' or old.ppr_status is distinct from new.ppr_status or old.ppr_received_by_employee_id is distinct from new.ppr_received_by_employee_id or old.ppr_received_date is distinct from new.ppr_received_date then
   if new.ppr_received_by_employee_id is null or new.ppr_received_date is null then raise exception 'PPR received requires employee and date';end if;
   select name into v_name from public.employees where id=new.ppr_received_by_employee_id and company_id=new.company_id and is_active;if v_name is null then raise exception 'PPR employee company mismatch or inactive';end if;new.ppr_received_by_name:=v_name;
  end if;
 elsif new.ppr_received_by_employee_id is not null or new.ppr_received_date is not null then raise exception 'PPR receipt details require received status';end if;
 if tg_op='UPDATE' and new.po_do_job_no is distinct from old.po_do_job_no then insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,actor_id) values(new.company_id,new.business_unit_id,new.id,new.trip_no,'job_change',to_jsonb(old.po_do_job_no),to_jsonb(new.po_do_job_no),auth.uid());end if;
 if tg_op='UPDATE' and (new.ppr_status,new.ppr_received_by_employee_id,new.ppr_received_date) is distinct from (old.ppr_status,old.ppr_received_by_employee_id,old.ppr_received_date) then insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,actor_id) values(new.company_id,new.business_unit_id,new.id,new.trip_no,'ppr_change',jsonb_build_object('status',old.ppr_status,'employee_id',old.ppr_received_by_employee_id,'date',old.ppr_received_date),jsonb_build_object('status',new.ppr_status,'employee_id',new.ppr_received_by_employee_id,'date',new.ppr_received_date),auth.uid());end if;
 if tg_op='UPDATE' and new.customer_rate is distinct from old.customer_rate and old.customer_rate_state='finalized' and not exists(select 1 from public.transport_action_gate where transaction_id=txid_current() and trip_id=new.id and action='customer_rate_finalize') then raise exception 'Finalized customer rate requires controlled override';end if;
 return new;
end $$;