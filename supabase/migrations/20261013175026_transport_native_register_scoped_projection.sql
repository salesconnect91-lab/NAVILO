begin;
do $patch$ declare d text;f text;begin
 d:=pg_get_viewdef('public.transport_financial_register'::regclass,true);
 if strpos(d,'transport_display_trip_no(t.id, t.trip_no)')=0 then raise exception 'Expected source identity projection missing';end if;
 d:=replace(d,'transport_display_trip_no(t.id, t.trip_no)','coalesce(nullif(hi.source_trip_id,''''),t.trip_no)');
 d:=replace(d,'hi.driver_name_snapshot','case when exists(select 1 from public.transport_trip_audit pa where pa.trip_id=t.id and pa.action=''import_primary_assignment'') then public.transport_import_primary_label(hi.driver_name_snapshot,''driver'') else hi.driver_name_snapshot end');
 d:=replace(d,'hi.vehicle_no_snapshot','case when exists(select 1 from public.transport_trip_audit pa where pa.trip_id=t.id and pa.action=''import_primary_assignment'') then public.transport_import_primary_label(hi.vehicle_no_snapshot,''vehicle'') else hi.vehicle_no_snapshot end');
 execute 'create or replace view public.transport_financial_register as '||d;
 f:=pg_get_functiondef('public._transport_native_register_rows(uuid,uuid,uuid)'::regprocedure);
 f:=replace(f,'select fr.* from public.transport_financial_register fr join public.transport_trips t on t.id=fr.id','select fr.* from public.transport_financial_register fr join public.transport_trips t on t.id=fr.id');
 f:=replace(f,'), financial_rows as materialized (', '), financial_rows as materialized (');
 f:=replace(f,'where t.company_id=p_company and t.business_unit_id=p_unit and t.operating_location_id=p_location
 )
 select fr.* from financial_rows fr join eligible_ids e on e.id=fr.id;', 'where t.company_id=p_company and t.business_unit_id=p_unit and t.operating_location_id=p_location and exists(select 1 from eligible_ids e where e.id=fr.id)
 )
 select fr.* from financial_rows fr;');
 if strpos(f,'select fr.* from financial_rows fr join eligible_ids')>0 then raise exception 'Expected scoped projection replacement missing';end if;
 execute f;
 f:=pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
 if strpos(f,'register_source as not materialized')=0 then raise exception 'Expected Register source cache marker missing';end if;
 execute replace(f,'register_source as not materialized','register_source as materialized');
end $patch$;
commit;