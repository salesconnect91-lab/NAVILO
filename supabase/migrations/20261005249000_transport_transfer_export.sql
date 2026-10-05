create or replace function public.transport_transfer_export_page(p_limit integer default 500,p_offset integer default 0)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();company_name text;total bigint;items jsonb;
begin
 if auth.uid() is null or c is null or b is null then raise exception 'Active workspace required';end if;
 if not public.has_module_permission(c,'transport','read') then raise exception 'Transport read permission required';end if;
 if p_limit not between 1 and 500 or p_offset<0 then raise exception 'Invalid export page';end if;
 select name into company_name from public.companies where id=c;
 select count(*) into total from public.transport_trips t where t.company_id=c and t.business_unit_id=b;
 select coalesce(jsonb_agg(x.obj order by x.trip_date,x.trip_no),'[]'::jsonb) into items from(
  select t.trip_date,t.trip_no,jsonb_build_object(
   'source_company',company_name,'source_trip_id',t.id::text,'source_trip_no',t.trip_no,'trip_date',t.trip_date,
   'customer_id',t.customer_id,'customer',coalesce(cu.name,t.customer_name_snapshot),
   'vehicle_id',t.vehicle_id,'vehicle_no',v.vehicle_no,'driver_id',t.driver_id,'driver',d.driver_name,'driver_code',d.driver_code,
   'truck_type_id',t.truck_type_id,'truck_type',tt.name,
   'from_location',coalesce(fl.name,t.from_location),'to_location',coalesce(tl.name,t.to_location),
   'from_location_id',t.from_location_id,'to_location_id',t.to_location_id,'job_no',t.po_do_job_no,
   'sale_type',t.sale_type,'notes',t.notes
  ) obj
  from public.transport_trips t
  left join public.customers cu on cu.id=t.customer_id and cu.company_id=t.company_id
  left join public.transport_vehicles v on v.id=t.vehicle_id and v.company_id=t.company_id and v.business_unit_id=t.business_unit_id
  left join public.transport_drivers d on d.id=t.driver_id and d.company_id=t.company_id and d.business_unit_id=t.business_unit_id
  left join public.transport_truck_types tt on tt.id=t.truck_type_id and tt.company_id=t.company_id and tt.business_unit_id=t.business_unit_id
  left join public.transport_locations fl on fl.id=t.from_location_id and fl.company_id=t.company_id and fl.business_unit_id=t.business_unit_id
  left join public.transport_locations tl on tl.id=t.to_location_id and tl.company_id=t.company_id and tl.business_unit_id=t.business_unit_id
  where t.company_id=c and t.business_unit_id=b order by t.trip_date,t.trip_no limit p_limit offset p_offset
 )x;
 return jsonb_build_object('rows',items,'total_count',total);
end$$;
revoke all on function public.transport_transfer_export_page(integer,integer) from public,anon;
grant execute on function public.transport_transfer_export_page(integer,integer) to authenticated;