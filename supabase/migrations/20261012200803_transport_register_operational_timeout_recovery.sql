-- Applied in production. Recovery contains only operational columns, no financial estimates.
CREATE OR REPLACE FUNCTION public.transport_register_operational_recovery(p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_search text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '10s'
AS $function$
DECLARE c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); loc uuid:=public.current_operating_location_id(); output jsonb;
BEGIN
 IF auth.uid() IS NULL OR c IS NULL OR b IS NULL OR loc IS NULL OR NOT public.has_module_permission(c,'transport','view')
 THEN RAISE EXCEPTION 'Transport view permission and active workspace required'; END IF;
 IF length(coalesce(p_search,''))>120 THEN RAISE EXCEPTION 'Search too long'; END IF;
 WITH matched AS MATERIALIZED (
  SELECT t.id,t.trip_no,t.trip_date,t.customer_id,t.driver_id,t.vehicle_id,
   t.po_do_job_no,t.from_location,t.to_location,t.truck_type,t.ppr_status,
   t.ppr_received_by_name,t.ppr_received_date,t.lifecycle_status,
   coalesce(cu.name,t.customer_name_snapshot) customer_name,
   coalesce(d.driver_name,hi.driver_name_snapshot) driver_name,
   coalesce(v.vehicle_no,hi.vehicle_no_snapshot) vehicle_no,
   coalesce(nullif(hi.source_trip_id,''),nullif(t.transport_source_trip_id,''),t.trip_no) display_trip_no
  FROM public.transport_trips t
  LEFT JOIN public.customers cu ON cu.id=t.customer_id
  LEFT JOIN public.transport_drivers d ON d.id=t.driver_id
  LEFT JOIN public.transport_vehicles v ON v.id=t.vehicle_id
  LEFT JOIN public.transport_historical_trip_identity hi ON hi.trip_id=t.id AND hi.company_id=c AND hi.business_unit_id=b AND hi.operating_location_id=loc
  WHERE t.company_id=c AND t.business_unit_id=b AND t.operating_location_id=loc
   AND (btrim(coalesce(p_search,''))='' OR concat_ws(' ',coalesce(hi.source_trip_id,t.transport_source_trip_id,t.trip_no),t.trip_no,cu.name,t.customer_name_snapshot,d.driver_name,hi.driver_name_snapshot,v.vehicle_no,hi.vehicle_no_snapshot,t.po_do_job_no,t.from_location,t.to_location) ILIKE '%'||replace(replace(replace(btrim(p_search),'\\','\\\\'),'%','\\%'),'_','\\_')||'%' ESCAPE '\\')
 ), paged AS (
  SELECT * FROM matched ORDER BY trip_date DESC,trip_no DESC,id LIMIT greatest(1,least(coalesce(p_limit,100),100)) OFFSET greatest(0,coalesce(p_offset,0))
 )
 SELECT jsonb_build_object(
  'rows',coalesce((SELECT jsonb_agg(to_jsonb(x)||jsonb_build_object('trip_no',x.display_trip_no,'status',x.lifecycle_status) ORDER BY x.trip_date DESC,x.trip_no DESC,x.id) FROM paged x),'[]'::jsonb),
  'count',(SELECT count(*) FROM matched),'recovery_only',true
 ) INTO output;
 RETURN output;
END $function$
;
REVOKE ALL ON FUNCTION public.transport_register_operational_recovery(integer,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_register_operational_recovery(integer,integer,text) TO authenticated;
