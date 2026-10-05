create or replace function public.transport_apply_source_trip_update(p_source_company text,p_source_trip_id text,p_changes jsonb,p_vehicle_id uuid,p_driver_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();t public.transport_trips%rowtype;cls jsonb;tid uuid;
begin
 if auth.uid() is null or c is null or b is null then raise exception 'Active workspace required';end if;
 select * into t from public.transport_trips where company_id=c and business_unit_id=b and lower(btrim(transport_source_company))=lower(btrim(p_source_company)) and lower(btrim(transport_source_trip_id))=lower(btrim(p_source_trip_id)) for update;
 if not found then raise exception 'Source Trip is not imported in this workspace';end if;
 cls:=public.transport_classify_source_trip(p_source_company,p_source_trip_id,coalesce(nullif(p_changes->>'trip_date','')::date,t.trip_date),coalesce(nullif(p_changes->>'customer_id','')::uuid,t.customer_id),p_vehicle_id,p_driver_id,coalesce(nullif(p_changes->>'from_location_id','')::uuid,t.from_location_id),coalesce(nullif(p_changes->>'to_location_id','')::uuid,t.to_location_id),coalesce(p_changes->>'po_do_job_no',t.po_do_job_no));
 if cls->>'status'='Duplicate' then return cls;end if;
 if cls->>'status'<>'Update' then raise exception '%',coalesce(cls->>'reason','Source Trip is not safely updateable');end if;
 -- IDs used only for classification; canonical operational RPC resolves route by names.
 p_changes:=p_changes-'from_location_id'-'to_location_id';
 if (p_vehicle_id,p_driver_id) is distinct from (t.vehicle_id,t.driver_id) then
   perform public.transport_replace_trip_assignment(t.id,p_vehicle_id,p_driver_id,'NAVILO source Trip import update');
 end if;
 tid:=public.transport_update_operational_trip(t.id,p_changes||jsonb_build_object('correction_reason','NAVILO source Trip import update'));
 return jsonb_build_object('status','Update','trip_id',tid,'trip_no',t.trip_no);
end$$;
revoke all on function public.transport_apply_source_trip_update(text,text,jsonb,uuid,uuid) from public,anon;
grant execute on function public.transport_apply_source_trip_update(text,text,jsonb,uuid,uuid) to authenticated;