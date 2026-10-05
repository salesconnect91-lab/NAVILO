-- Target-company master resolution for NAVILO-to-NAVILO Transport transfer.
-- Production applied as transport_transfer_master_resolution.
create or replace function public.transport_resolve_transfer_masters(p_customer text,p_vehicle_no text,p_driver_code text,p_driver_name text,p_truck_type text,p_from_location text,p_to_location text) returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();cu uuid;v uuid;d uuid;tt uuid;fl uuid;tl uuid;
begin
 if auth.uid() is null or c is null or b is null then raise exception 'Active workspace required'; end if;
 select id into cu from public.customers where company_id=c and is_active=true and lower(btrim(name))=lower(btrim(p_customer)) limit 1;
 if nullif(btrim(p_vehicle_no),'') is not null then select id into v from public.transport_vehicles where company_id=c and business_unit_id=b and lower(btrim(vehicle_no))=lower(btrim(p_vehicle_no)) and is_active=true limit 1; end if;
 if nullif(btrim(p_driver_code),'') is not null then select id into d from public.transport_drivers where company_id=c and business_unit_id=b and lower(btrim(driver_code))=lower(btrim(p_driver_code)) and is_active=true limit 1; end if;
 if d is null and nullif(btrim(p_driver_name),'') is not null then select id into d from public.transport_drivers where company_id=c and business_unit_id=b and lower(btrim(driver_name))=lower(btrim(p_driver_name)) and is_active=true limit 1; end if;
 if nullif(btrim(p_truck_type),'') is not null then select id into tt from public.transport_truck_types where company_id=c and business_unit_id=b and lower(btrim(name))=lower(btrim(p_truck_type)) and is_active=true limit 1; end if;
 select id into fl from public.transport_locations where company_id=c and business_unit_id=b and lower(btrim(name))=lower(btrim(p_from_location)) and is_active=true limit 1;
 select id into tl from public.transport_locations where company_id=c and business_unit_id=b and lower(btrim(name))=lower(btrim(p_to_location)) and is_active=true limit 1;
 return jsonb_build_object('customer_id',cu,'vehicle_id',v,'driver_id',d,'truck_type_id',tt,'from_location_id',fl,'to_location_id',tl,'status',case when cu is null or fl is null or tl is null or (nullif(btrim(p_vehicle_no),'') is not null and v is null) or ((nullif(btrim(p_driver_code),'') is not null or nullif(btrim(p_driver_name),'') is not null) and d is null) or (nullif(btrim(p_truck_type),'') is not null and tt is null) then 'Error' else 'Resolved' end);
end$$;
revoke all on function public.transport_resolve_transfer_masters(text,text,text,text,text,text,text) from public,anon;
grant execute on function public.transport_resolve_transfer_masters(text,text,text,text,text,text,text) to authenticated;