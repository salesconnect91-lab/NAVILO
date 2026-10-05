create or replace function public.transport_classify_source_trip(p_source_company text,p_source_trip_id text,p_trip_date date,p_customer_id uuid,p_vehicle_id uuid,p_driver_id uuid,p_from_location_id uuid,p_to_location_id uuid,p_po_do_job_no text)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();t public.transport_trips%rowtype;locked boolean;
begin
 if auth.uid() is null or c is null or b is null then raise exception 'Active workspace required';end if;
 if nullif(btrim(p_source_company),'') is null or nullif(btrim(p_source_trip_id),'') is null then return jsonb_build_object('status','Error','reason','Source Company and Source Trip ID are required');end if;
 select * into t from public.transport_trips where company_id=c and business_unit_id=b and lower(btrim(transport_source_company))=lower(btrim(p_source_company)) and lower(btrim(transport_source_trip_id))=lower(btrim(p_source_trip_id)) limit 1;
 if not found then return jsonb_build_object('status','New');end if;
 if (t.trip_date,t.customer_id,t.vehicle_id,t.driver_id,t.from_location_id,t.to_location_id,coalesce(btrim(t.po_do_job_no),''))
    is not distinct from (p_trip_date,p_customer_id,p_vehicle_id,p_driver_id,p_from_location_id,p_to_location_id,coalesce(btrim(p_po_do_job_no),''))
 then return jsonb_build_object('status','Duplicate','trip_id',t.id,'trip_no',t.trip_no);end if;
 locked:=t.sales_order_id is not null
   or exists(select 1 from public.transport_customer_documents d where d.trip_id=t.id)
   or exists(select 1 from public.transport_supplier_document_trips d where d.trip_id=t.id)
   or exists(select 1 from public.transport_driver_accrual_attributions d where d.trip_id=t.id)
   or exists(select 1 from public.transport_driver_payment_attributions d where d.trip_id=t.id);
 if locked then return jsonb_build_object('status','Error','trip_id',t.id,'trip_no',t.trip_no,'reason','Source Trip differs but financial evidence exists; use controlled correction/reversal, not import update');end if;
 return jsonb_build_object('status','Update','trip_id',t.id,'trip_no',t.trip_no);
end$$;
revoke all on function public.transport_classify_source_trip(text,text,date,uuid,uuid,uuid,uuid,uuid,text) from public,anon;
grant execute on function public.transport_classify_source_trip(text,text,date,uuid,uuid,uuid,uuid,uuid,text) to authenticated;