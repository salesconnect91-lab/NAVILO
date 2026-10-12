-- Optimizes operational dropdown choices without rewriting historical evidence.
-- Dynamic redefinition deliberately preserves current canonical financial logic.
DO $fast_register_migration$
DECLARE old_definition text;
DECLARE old_md5 text;
BEGIN
 SELECT pg_get_functiondef(oid),md5(pg_get_functiondef(oid))
 INTO old_definition,old_md5
 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='transport_register_query';
 IF old_md5 IS DISTINCT FROM '9fc2c90cb4477626756322bf5bb5ed9d' THEN
   RAISE EXCEPTION 'Concurrent transport_register_query change; rebase required';
 END IF;
 IF old_definition IS NULL OR position(' needs_cells:=' in old_definition)=0 THEN
   RAISE EXCEPTION 'Transport Register function replacement anchor missing';
 END IF;
 old_definition := replace(old_definition,' needs_cells:=',$register_fast_path$ -- Unposted operational filter values must not require the expensive
 -- correlated financial/register view. All financial filters, status filters
 -- and full text searches keep the original authoritative path.
 if p_option_key=any(array['trip_no','trip_date','truck_type','job_no','company','driver','plate','from','to','paper_received_by'])
    and btrim(coalesce(p_filters->>'search',''))=''
    and coalesce(jsonb_array_length(p_filters->'statuses'),0)=0
    and not exists(
      select 1 from jsonb_each(coalesce(p_filters->'columns','{}'::jsonb)) f
      where f.key not in ('trip_no','trip_date','truck_type','job_no','company','driver','plate','from','to','paper_received_by')
      and jsonb_array_length(f.value)>0
    )
 then
   with operational as (
     select
      t.trip_date,t.ppr_status,t.from_location,t.to_location,
      coalesce(cu.name,t.customer_name_snapshot) customer_name,
      coalesce(dr.driver_name,hi.driver_name_snapshot) driver_name,
      coalesce(v.vehicle_no,hi.vehicle_no_snapshot) vehicle_no,
      jsonb_build_object(
        'trip_no',coalesce(nullif(t.trip_no,''),'?'),
        'trip_date',coalesce(nullif(to_char(t.trip_date,'DD-Mon-YY'),''),'?'),
        'truck_type',coalesce(nullif(coalesce(tt.name,t.truck_type,v.truck_type),''),'?'),
        'job_no',coalesce(nullif(t.po_do_job_no,''),'?'),
        'company',coalesce(nullif(coalesce(cu.name,t.customer_name_snapshot),''),'?'),
        'driver',coalesce(nullif(coalesce(dr.driver_name,hi.driver_name_snapshot),''),'?'),
        'plate',coalesce(nullif(coalesce(v.vehicle_no,hi.vehicle_no_snapshot),''),'?'),
        'from',coalesce(nullif(t.from_location,''),'?'),
        'to',coalesce(nullif(t.to_location,''),'?'),
        'paper_received_by',coalesce(nullif(case when t.ppr_status='received'
          then coalesce(nullif(t.ppr_received_by_name,''),'—')
            ||coalesce(' · '||to_char(t.ppr_received_date,'DD-Mon-YY'),'')
          else 'Pending' end,''),'?')
      ) cells
     from public.transport_trips t
     left join public.customers cu on cu.id=t.customer_id
     left join public.transport_vehicles v on v.id=t.vehicle_id
     left join public.transport_drivers dr on dr.id=t.driver_id
     left join public.transport_truck_types tt on tt.id=t.truck_type_id
     left join public.transport_historical_trip_identity hi on hi.trip_id=t.id
          and hi.company_id=t.company_id and hi.business_unit_id=t.business_unit_id
          and hi.operating_location_id=t.operating_location_id
     where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc
       and (coalesce(p_filters->>'fromDate','')='' or t.trip_date>=(p_filters->>'fromDate')::date)
       and (coalesce(p_filters->>'toDate','')='' or t.trip_date<=(p_filters->>'toDate')::date)
   ),
   matched as (
      select o.cells->>p_option_key value
      from operational o
      where (coalesce(p_filters->>'customer','')='' or o.customer_name=p_filters->>'customer')
        and (coalesce(p_filters->>'driver','')='' or o.driver_name=p_filters->>'driver')
        and (coalesce(p_filters->>'vehicle','')='' or o.vehicle_no=p_filters->>'vehicle')
        and (coalesce(p_filters->>'from','')='' or o.from_location=p_filters->>'from')
        and (coalesce(p_filters->>'to','')='' or o.to_location=p_filters->>'to')
        and (coalesce(p_filters->>'ppr','')='' or o.ppr_status=p_filters->>'ppr')
        and not exists(
         select 1 from jsonb_each(coalesce(p_filters->'columns','{}'::jsonb)) f
         where f.key is distinct from p_option_key and jsonb_array_length(f.value)>0
           and not f.value @> jsonb_build_array(o.cells->>f.key)
        )
        and position(lower(btrim(coalesce(p_option_search,''))) in lower(o.cells->>p_option_key))>0
   )
   select jsonb_build_object('options',coalesce(jsonb_agg(value order by value),'[]'::jsonb))
   into answer from (select distinct value from matched) v;
   return answer;
 end if;
$register_fast_path$||' needs_cells:=');
 EXECUTE old_definition;
END $fast_register_migration$;
