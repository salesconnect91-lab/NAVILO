begin;
do $filters$
declare d text;anchor text;replacement text;
begin
 d:=pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
 anchor:=' r union all select r.* from public._transport_native_register_rows(c,b,loc) r), agreed_rents as materialized (';
 if position(anchor in d)=0 then raise exception 'Unexpected inline Register source';end if;
 replacement:=$where$ r where
 (coalesce(p_filters->>'fromDate','')='' or r.trip_date>=(p_filters->>'fromDate')::date)
 and (coalesce(p_filters->>'toDate','')='' or r.trip_date<=(p_filters->>'toDate')::date)
 and (coalesce(p_filters->>'customer','')='' or r.customer_name=p_filters->>'customer')
 and (coalesce(p_filters->>'driver','')='' or r.driver_name=p_filters->>'driver')
 and (coalesce(p_filters->>'vehicle','')='' or r.vehicle_no=p_filters->>'vehicle')
 and (coalesce(p_filters->>'from','')='' or r.from_location=p_filters->>'from')
 and (coalesce(p_filters->>'to','')='' or r.to_location=p_filters->>'to')
 and (coalesce(p_filters->>'ppr','')='' or r.ppr_status=p_filters->>'ppr')
 and not exists(
 select 1 from jsonb_each(coalesce(p_filters->'columns','{}')) f
 where f.key is distinct from p_option_key and jsonb_array_length(f.value)>0
 and f.key=any(array['trip_no','trip_date','truck_type','job_no','company','driver','owner','plate','from','to','paper_received_by','payment_date','invoice_no','supplier_invoice_no','sale_type','invoiced'])
 and not f.value @> jsonb_build_array(case f.key
 when 'trip_no' then coalesce(nullif(r.trip_no,''),'?')
 when 'trip_date' then coalesce(nullif(to_char(r.trip_date,'DD-Mon-YY'),''),'?')
 when 'truck_type' then coalesce(nullif(r.truck_type_name,''),'?')
 when 'job_no' then coalesce(nullif(r.po_do_job_no,''),'?')
 when 'company' then coalesce(nullif(r.customer_name,''),'?')
 when 'driver' then coalesce(nullif(r.driver_name,''),'?')
 when 'owner' then coalesce(nullif(r.owner_name,''),'?')
 when 'plate' then coalesce(nullif(r.vehicle_no,''),'?')
 when 'from' then coalesce(nullif(r.from_location,''),'?')
 when 'to' then coalesce(nullif(r.to_location,''),'?')
 when 'paper_received_by' then case when r.ppr_status='received' then coalesce(nullif(r.ppr_received_by_name,''),'—')||coalesce(' · '||to_char(r.ppr_received_date,'DD-Mon-YY'),'') else 'Pending' end
 when 'payment_date' then coalesce(nullif(to_char(r.payment_date,'DD-Mon-YY'),''),'?')
 when 'invoice_no' then coalesce(nullif(r.historical_customer_invoice_ref,''),'?')
 when 'supplier_invoice_no' then coalesce(nullif(r.historical_supplier_invoice_ref,''),'?')
 when 'sale_type' then coalesce(nullif(r.sale_type,''),'?')
 when 'invoiced' then case when r.invoiced then 'Yes' else 'No' end end))
 and (coalesce(replace(btrim(p_filters->>'search'),',',''),'') !~ '^[0-9]{4}-[0-9]+$'
 or position(lower(replace(btrim(p_filters->>'search'),',','')) in lower(replace(concat_ws(' ',r.trip_no,r.truck_type_name,r.po_do_job_no,r.customer_name,r.driver_name,r.owner_name,r.vehicle_no,r.from_location,r.to_location,r.ppr_received_by_name,r.historical_customer_invoice_ref,r.historical_supplier_invoice_ref),',','')))>0
 or exists(select 1 from public.transport_trip_supplier_charges sc where sc.trip_id=r.id and position(lower(replace(btrim(p_filters->>'search'),',','')) in lower(replace(sc.charge_key_snapshot,',','')))>0))
 union all select r.* from public._transport_native_register_rows(c,b,loc) r), agreed_rents as materialized ($where$;
 d:=replace(d,anchor,replacement);
 execute d;
end $filters$;
notify pgrst,'reload schema';
commit;
