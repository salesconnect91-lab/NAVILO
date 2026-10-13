begin;
create or replace function public._transport_native_register_rows(p_company uuid,p_unit uuid,p_location uuid)
returns setof public.transport_financial_register
language plpgsql stable rows 20000 set search_path=public,pg_temp set work_mem='64MB' set plan_cache_mode='force_custom_plan' as $function$
begin
 if exists(select 1 from public.transport_opening_invoice_documents where company_id=p_company and business_unit_id=p_unit and operating_location_id=p_location) then
 return query
 with financial_ids as materialized (
 select trip_id from public.transport_customer_document_trips union select trip_id from public.transport_supplier_document_rents
 union select trip_id from public.transport_driver_accrual_attributions union select trip_id from public.transport_driver_payment_attributions
 union select trip_id from public.transport_service_cost_links
 ), opening_ids as materialized (
 select distinct l.trip_id from public.transport_opening_invoice_lines l join public.transport_opening_invoice_documents d on d.id=l.document_id
 where d.company_id=p_company and d.business_unit_id=p_unit and d.operating_location_id=p_location
 ), eligible_ids as materialized (
 select t.id from public.transport_trips t left join opening_ids o on o.trip_id=t.id left join financial_ids f on f.trip_id=t.id
 where t.company_id=p_company and t.business_unit_id=p_unit and t.operating_location_id=p_location
 and (o.trip_id is null or f.trip_id is not null or t.sales_order_id is not null)
 ), financial_rows as materialized (
 select fr.* from public.transport_financial_register fr join public.transport_trips t on t.id=fr.id
 where t.company_id=p_company and t.business_unit_id=p_unit and t.operating_location_id=p_location
 )
 select fr.* from financial_rows fr join eligible_ids e on e.id=fr.id;
 else
 return query select fr.* from public.transport_financial_register fr join public.transport_trips t on t.id=fr.id
 where t.company_id=p_company and t.business_unit_id=p_unit and t.operating_location_id=p_location;
 end if;
end $function$;
revoke all on function public._transport_native_register_rows(uuid,uuid,uuid) from public,anon,authenticated;
commit;