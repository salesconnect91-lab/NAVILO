-- Forward-only: Locked Trip remains immutable except audited PPR and Remarks fields.
CREATE OR REPLACE FUNCTION public.transport_update_operational_trip(p_trip_id uuid, p_changes jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.transport_trips%rowtype;r public.transport_trips%rowtype;k text;
 allowed text[]:=array['trip_date','customer_id','customer_name_snapshot','truck_type_id','from_location','to_location','po_do_job_no','ppr_status','ppr_received_date','ppr_received_by_employee_id','ppr_attachment_path','sale_type','notes','correction_reason'];
 from_place public.transport_locations%rowtype;to_place public.transport_locations%rowtype;own public.transport_vehicle_ownership%rowtype;reason text;
begin
 if not public.has_module_permission(public.current_company_id(),'transport','edit') or not public.has_transport_action_permission(public.current_company_id(),'trip_edit') then raise exception 'Trip edit permission required';end if;
 if jsonb_typeof(p_changes) is distinct from 'object' or octet_length(p_changes::text)>20000 then raise exception 'Invalid Trip changes';end if;
 for k in select jsonb_object_keys(p_changes) loop if not k=any(allowed) then raise exception 'Unsupported operational field %',k;end if;end loop;
 select * into t from public.transport_trips where id=p_trip_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() for update;
 if not found then raise exception 'Trip not found in workspace';end if;
 if public.transport_customer_side_posted(t.id) and not exists(select 1 from public.transport_trip_supplier_rents sr where sr.trip_id=t.id and not exists(select 1 from public.transport_supplier_document_rents d where d.rent_id=sr.id and not d.is_adjustment)) then
   if exists (
     select 1 from jsonb_object_keys(p_changes) x(key)
     where x.key not in ('ppr_status','ppr_received_date','ppr_received_by_employee_id','ppr_attachment_path','notes')
   ) then raise exception 'Locked Trip allows only PPR and Remarks updates; use controlled correction / reversal for other changes.'; end if;
 end if;
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
end $function$
;
