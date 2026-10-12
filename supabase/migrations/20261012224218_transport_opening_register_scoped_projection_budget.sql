-- Keep native financial view planning behind the per-Trip fallback. For an
-- imported-only page that view must not be expanded hundreds of times merely
-- to construct a composite Register row. No financial/source records change.
begin;
create function public._transport_linked_register_source(p_company uuid,p_unit uuid,p_location uuid)
returns setof public.transport_financial_register language plpgsql stable security invoker
set search_path=public,pg_temp set work_mem='64MB' as $source$
declare row_id uuid;
begin
 if exists(select 1 from public.transport_opening_invoice_documents where company_id=p_company and business_unit_id=p_unit and operating_location_id=p_location) then
  return query select * from public._transport_opening_register_rows(p_company,p_unit,p_location);
  for row_id in
   select t.id from public.transport_trips t where t.company_id=p_company and t.business_unit_id=p_unit and t.operating_location_id=p_location
    and (not exists(select 1 from public.transport_opening_invoice_lines ol where ol.trip_id=t.id)
     or t.sales_order_id is not null
     or exists(select 1 from public.transport_customer_document_trips n where n.trip_id=t.id)
     or exists(select 1 from public.transport_supplier_document_rents n where n.trip_id=t.id)
     or exists(select 1 from public.transport_driver_accrual_attributions n where n.trip_id=t.id)
     or exists(select 1 from public.transport_driver_payment_attributions n where n.trip_id=t.id)
     or exists(select 1 from public.transport_service_cost_links n where n.trip_id=t.id))
  loop
   return query select fr.* from public.transport_financial_register fr where fr.id=row_id;
  end loop;
 else
  return query select fr.* from public.transport_financial_register fr join public.transport_trips t on t.id=fr.id
   where t.company_id=p_company and t.business_unit_id=p_unit and t.operating_location_id=p_location;
 end if;
end $source$;
revoke all on function public._transport_linked_register_source(uuid,uuid,uuid) from public,anon,authenticated;

do $budget$
declare d text;begin_at integer;end_at integer;
begin
 d:=pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
 begin_at:=position('with native_trip_ids as materialized' in d);
 end_at:=position('), agreed_rents as materialized (' in d);
 if begin_at=0 or end_at<begin_at then raise exception 'Unexpected linked Register source';end if;
 d:=substring(d from 1 for begin_at-1)||'with register_source as materialized (select r.* from public._transport_linked_register_source(c,b,loc) r'||substring(d from end_at);
 -- Existing correction overlays keep their evidence and dates, but use the
 -- workspace IDs already authorized and captured by the Register function.
 d:=replace(d,'c.trip_id','pc.trip_id');d:=replace(d,'c.corrected_name','pc.corrected_name');
 d:=replace(d,'public.transport_ppr_receiver_corrections c','public.transport_ppr_receiver_corrections pc');
 d:=replace(d,'c.company_id=public.current_company_id() and c.business_unit_id=public.current_business_unit_id()', 'pc.company_id=c and pc.business_unit_id=b');
 execute d;
 d:=pg_get_functiondef('public._transport_opening_register_rows(uuid,uuid,uuid)'::regprocedure);
 d:=replace(d,'transport_display_trip_no(t.id, t.trip_no)','COALESCE(NULLIF(hi.source_trip_id, ''''), t.trip_no)');
 execute d;
end $budget$;
notify pgrst,'reload schema';
commit;
