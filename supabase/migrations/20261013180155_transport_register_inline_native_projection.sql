begin;
do $patch$ declare f text;native_sql text;old_marker text:='public._transport_native_register_rows(c,b,loc)';begin
 f:=pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
 if strpos(f,old_marker)=0 then raise exception 'Expected native Register source marker missing';end if;
 native_sql:=$native$(
 with financial_ids as materialized (
 select trip_id from public.transport_customer_document_trips union select trip_id from public.transport_supplier_document_rents
 union select trip_id from public.transport_driver_accrual_attributions union select trip_id from public.transport_driver_payment_attributions
 union select trip_id from public.transport_service_cost_links
 ), opening_ids as materialized (
 select distinct l.trip_id from public.transport_opening_invoice_lines l join public.transport_opening_invoice_documents d on d.id=l.document_id where d.company_id=c and d.business_unit_id=b and d.operating_location_id=loc
 ), eligible_ids as materialized (
 select t.id from public.transport_trips t left join opening_ids o on o.trip_id=t.id left join financial_ids f on f.trip_id=t.id
 where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc
 and (o.trip_id is null or f.trip_id is not null or t.sales_order_id is not null)
 )
 select fr.* from public.transport_financial_register fr join eligible_ids e on e.id=fr.id
 where fr.company_id=c and fr.business_unit_id=b
)$native$;
 execute replace(f,old_marker,native_sql);
end $patch$;
commit;