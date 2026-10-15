-- NAVILO: Align fast header-filter labels with the canonical Register's
-- historical driver/vehicle mapping. No Trip/master/financial rows are changed.
DO $fix$
DECLARE
 body text:=pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
 section text;
 front text;
 tail text;
 first_pos integer;
 last_pos integer;
 n_driver integer;
 n_vehicle integer;
 n_join integer;
BEGIN
 first_pos:=position($start$ -- Unposted operational filter values must not require the expensive$start$ in body);
 last_pos:=position($finish$ -- A wholly unlinked, unposted workspace needs operational aggregates$finish$ in body);
 IF first_pos=0 OR last_pos<=first_pos THEN
  RAISE EXCEPTION 'Transport header-option function structure changed; migration aborted';
 END IF;
 front:=left(body,first_pos-1);
 section:=substr(body,first_pos,last_pos-first_pos);
 tail:=substr(body,last_pos);
 IF position($already$hm.driver_master_id IS NOT DISTINCT FROM t.driver_id$already$ in section)>0
    AND position($already$hm.vehicle_master_id IS NOT DISTINCT FROM t.vehicle_id$already$ in section)>0
 THEN
  RAISE NOTICE 'Canonical historical header-option mapping is already active';
  RETURN;
 END IF;
 n_driver:=(length(section)-length(replace(section,$driver_old$coalesce(dr.driver_name,CASE WHEN EXISTS(SELECT 1 FROM public.transport_trip_audit pa WHERE pa.trip_id=t.id AND pa.action='import_primary_assignment') THEN public.transport_import_primary_label(hi.driver_name_snapshot,'driver') ELSE hi.driver_name_snapshot END)$driver_old$,'')))/length($driver_old$coalesce(dr.driver_name,CASE WHEN EXISTS(SELECT 1 FROM public.transport_trip_audit pa WHERE pa.trip_id=t.id AND pa.action='import_primary_assignment') THEN public.transport_import_primary_label(hi.driver_name_snapshot,'driver') ELSE hi.driver_name_snapshot END)$driver_old$);
 n_vehicle:=(length(section)-length(replace(section,$vehicle_old$coalesce(v.vehicle_no,CASE WHEN EXISTS(SELECT 1 FROM public.transport_trip_audit pa WHERE pa.trip_id=t.id AND pa.action='import_primary_assignment') THEN public.transport_import_primary_label(hi.vehicle_no_snapshot,'vehicle') ELSE hi.vehicle_no_snapshot END)$vehicle_old$,'')))/length($vehicle_old$coalesce(v.vehicle_no,CASE WHEN EXISTS(SELECT 1 FROM public.transport_trip_audit pa WHERE pa.trip_id=t.id AND pa.action='import_primary_assignment') THEN public.transport_import_primary_label(hi.vehicle_no_snapshot,'vehicle') ELSE hi.vehicle_no_snapshot END)$vehicle_old$);
 n_join:=(length(section)-length(replace(section,$join_old$     left join public.transport_historical_trip_identity hi on hi.trip_id=t.id
          and hi.company_id=t.company_id and hi.business_unit_id=t.business_unit_id
          and hi.operating_location_id=t.operating_location_id
     where t.company_id=c$join_old$,'')))/length($join_old$     left join public.transport_historical_trip_identity hi on hi.trip_id=t.id
          and hi.company_id=t.company_id and hi.business_unit_id=t.business_unit_id
          and hi.operating_location_id=t.operating_location_id
     where t.company_id=c$join_old$);
 IF n_driver<>2 OR n_vehicle<>2 OR n_join<>1 THEN
  RAISE EXCEPTION 'Expected two driver/vehicle expressions and one join, found %, %, %',n_driver,n_vehicle,n_join;
 END IF;
 section:=replace(section,$driver_old$coalesce(dr.driver_name,CASE WHEN EXISTS(SELECT 1 FROM public.transport_trip_audit pa WHERE pa.trip_id=t.id AND pa.action='import_primary_assignment') THEN public.transport_import_primary_label(hi.driver_name_snapshot,'driver') ELSE hi.driver_name_snapshot END)$driver_old$,$driver_new$(CASE WHEN hm.driver_master_id IS NOT DISTINCT FROM t.driver_id THEN COALESCE(CASE WHEN EXISTS(SELECT 1 FROM public.transport_trip_audit pa WHERE pa.trip_id=t.id AND pa.action='import_primary_assignment') THEN public.transport_import_primary_label(hi.driver_name_snapshot,'driver') ELSE hi.driver_name_snapshot END,dr.driver_name) ELSE COALESCE(dr.driver_name,CASE WHEN EXISTS(SELECT 1 FROM public.transport_trip_audit pa WHERE pa.trip_id=t.id AND pa.action='import_primary_assignment') THEN public.transport_import_primary_label(hi.driver_name_snapshot,'driver') ELSE hi.driver_name_snapshot END) END)$driver_new$);
 section:=replace(section,$vehicle_old$coalesce(v.vehicle_no,CASE WHEN EXISTS(SELECT 1 FROM public.transport_trip_audit pa WHERE pa.trip_id=t.id AND pa.action='import_primary_assignment') THEN public.transport_import_primary_label(hi.vehicle_no_snapshot,'vehicle') ELSE hi.vehicle_no_snapshot END)$vehicle_old$,$vehicle_new$(CASE WHEN hm.vehicle_master_id IS NOT DISTINCT FROM t.vehicle_id THEN COALESCE(CASE WHEN EXISTS(SELECT 1 FROM public.transport_trip_audit pa WHERE pa.trip_id=t.id AND pa.action='import_primary_assignment') THEN public.transport_import_primary_label(hi.vehicle_no_snapshot,'vehicle') ELSE hi.vehicle_no_snapshot END,v.vehicle_no) ELSE COALESCE(v.vehicle_no,CASE WHEN EXISTS(SELECT 1 FROM public.transport_trip_audit pa WHERE pa.trip_id=t.id AND pa.action='import_primary_assignment') THEN public.transport_import_primary_label(hi.vehicle_no_snapshot,'vehicle') ELSE hi.vehicle_no_snapshot END) END)$vehicle_new$);
 section:=replace(section,$join_old$     left join public.transport_historical_trip_identity hi on hi.trip_id=t.id
          and hi.company_id=t.company_id and hi.business_unit_id=t.business_unit_id
          and hi.operating_location_id=t.operating_location_id
     where t.company_id=c$join_old$,$join_new$     left join public.transport_historical_trip_identity hi on hi.trip_id=t.id
          and hi.company_id=t.company_id and hi.business_unit_id=t.business_unit_id
          and hi.operating_location_id=t.operating_location_id
     left join public.transport_historical_operational_mapping hm on hm.trip_id=t.id
          and hm.company_id=t.company_id and hm.business_unit_id=t.business_unit_id
          and hm.operating_location_id=t.operating_location_id
     where t.company_id=c$join_new$);
 EXECUTE front||section||tail;
END
$fix$;