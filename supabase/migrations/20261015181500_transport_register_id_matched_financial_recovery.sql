-- NAVILO: Authorized, ID-matched financial recovery for the EXISTING Trip Register.
-- Read-only source: no Trip, invoice, journal, payment, opening, or master mutation.
CREATE OR REPLACE FUNCTION public.transport_register_financial_recovery_page(p_trip_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
SET work_mem TO '64MB'
SET plan_cache_mode TO 'force_custom_plan'
SET statement_timeout TO '24s'
AS $fn$
DECLARE
 c uuid:=public.current_company_id();
 b uuid:=public.current_business_unit_id();
 loc uuid:=public.current_operating_location_id();
 cv boolean:=public.transport_financial_read_allowed('customer');
 sv boolean:=public.transport_financial_read_allowed('supplier');
 result jsonb;
 expected_count integer;
BEGIN
 IF auth.uid() IS NULL OR c IS NULL OR b IS NULL OR loc IS NULL
    OR NOT public.has_module_permission(c,'transport','view')
 THEN RAISE EXCEPTION 'Transport view permission and active workspace required'; END IF;
 IF p_trip_ids IS NULL OR cardinality(p_trip_ids) NOT BETWEEN 1 AND 100
 THEN RAISE EXCEPTION 'Provide 1–100 visible Trip IDs'; END IF;
 SELECT count(*) INTO expected_count
 FROM (select distinct unnest(p_trip_ids) id) ids;
 IF expected_count<>cardinality(p_trip_ids)
 THEN RAISE EXCEPTION 'Duplicate Trip IDs are not allowed'; END IF;
 IF (SELECT count(*) FROM public.transport_trips t
     WHERE t.id=ANY(p_trip_ids) AND t.company_id=c AND t.business_unit_id=b
       AND t.operating_location_id=loc)<>expected_count
 THEN RAISE EXCEPTION 'Trip page does not belong to active workspace'; END IF;
 WITH chosen_ids AS MATERIALIZED (
   SELECT t.id,t.sales_order_id FROM public.transport_trips t
   WHERE t.id=ANY(p_trip_ids) AND t.company_id=c
     AND t.business_unit_id=b AND t.operating_location_id=loc
 ),
 opening_ids AS MATERIALIZED (
   SELECT x.id FROM chosen_ids x
   WHERE x.sales_order_id IS NULL
     AND EXISTS (SELECT 1 FROM public.transport_opening_invoice_lines l WHERE l.trip_id=x.id)
     AND NOT EXISTS (SELECT 1 FROM public.transport_customer_document_trips l WHERE l.trip_id=x.id)
     AND NOT EXISTS (SELECT 1 FROM public.transport_supplier_document_rents l WHERE l.trip_id=x.id)
     AND NOT EXISTS (SELECT 1 FROM public.transport_driver_accrual_attributions l WHERE l.trip_id=x.id)
     AND NOT EXISTS (SELECT 1 FROM public.transport_driver_payment_attributions l WHERE l.trip_id=x.id)
     AND NOT EXISTS (SELECT 1 FROM public.transport_service_cost_links l WHERE l.trip_id=x.id)
 ),
 financial_rows AS MATERIALIZED (
   SELECT fr.* FROM public.transport_financial_register fr
   JOIN chosen_ids ids ON ids.id=fr.id
   WHERE fr.company_id=c AND fr.business_unit_id=b
     AND NOT EXISTS (SELECT 1 FROM opening_ids o WHERE o.id=fr.id)
 ),
 opening_rows AS MATERIALIZED (
   SELECT o.* FROM public._transport_opening_register_rows(c,b,loc) o
   JOIN opening_ids ids ON ids.id=o.id
 ),
 canonical_rows AS MATERIALIZED (
   SELECT * FROM financial_rows UNION ALL SELECT * FROM opening_rows
 ),
 enriched AS (
   SELECT r.id,
   CASE WHEN cv AND sv THEN to_jsonb(r)
        ELSE public._transport_mask_financial_row(to_jsonb(r),cv,sv)
   END
   || jsonb_build_object(
      'customer_charges', CASE WHEN cv THEN coalesce(cc.amount,0) END,
      'supplier_charges', CASE WHEN sv THEN coalesce(sc.amount,0) END,
      'supplier_rent', CASE WHEN sv THEN
         coalesce(r.billed_supplier_net,ar.amount,r.supplier_rent,r.owner_rent,0)
         +coalesce(r.historical_company_cost_net,0) END,
      'trip_profit', CASE WHEN cv AND sv THEN
         coalesce(r.billed_customer_net,r.customer_rate,0)
         -(coalesce(r.billed_supplier_net,ar.amount,r.supplier_rent,r.owner_rent,0)
           +coalesce(r.historical_company_cost_net,0))
         -greatest(coalesce(r.driver_pay,0),coalesce(r.driver_accrued,0))
         -coalesce(r.other_cost_net,0) END,
      'invoice_no', CASE WHEN cv THEN coalesce(ci.order_no,r.historical_customer_invoice_ref) END,
      'supplier_invoice_no', CASE WHEN sv THEN coalesce(si.order_nos,r.historical_supplier_invoice_ref) END,
      'ppr_received_by_name',coalesce(pc.corrected_name,r.ppr_received_by_name),
      'recovery_financial_verified',true
   ) AS data
   FROM canonical_rows r
   LEFT JOIN LATERAL (
      SELECT sum(amount) amount FROM public.transport_trip_customer_charges x WHERE x.trip_id=r.id
   ) cc ON true
   LEFT JOIN LATERAL (
      SELECT sum(amount) amount FROM public.transport_trip_supplier_charges x WHERE x.trip_id=r.id
   ) sc ON true
   LEFT JOIN LATERAL (
      SELECT sum(coalesce(finalized_amount_snapshot,amount)) amount
        FROM public.transport_trip_supplier_rents x WHERE x.trip_id=r.id
   ) ar ON true
   LEFT JOIN LATERAL (
      SELECT s.order_no FROM public.transport_customer_document_trips l
      JOIN public.transport_customer_documents d ON d.id=l.document_id
      JOIN public.sales_orders s ON s.id=d.sales_order_id
      WHERE l.trip_id=r.id AND NOT l.is_adjustment
      ORDER BY l.id LIMIT 1
   ) ci ON true
   LEFT JOIN LATERAL (
      SELECT string_agg(DISTINCT po.order_no,', ' ORDER BY po.order_no) order_nos
      FROM public.transport_trip_supplier_rents rent
      JOIN public.transport_supplier_document_rents l ON l.rent_id=rent.id AND NOT l.is_adjustment
      JOIN public.transport_supplier_documents d ON d.id=l.document_id
      JOIN public.purchase_orders po ON po.id=d.purchase_order_id
      JOIN public.transport_active_journals j ON j.id=d.journal_entry_id
      WHERE rent.trip_id=r.id
   ) si ON true
   LEFT JOIN public.transport_ppr_receiver_corrections pc
      ON pc.trip_id=r.id AND pc.company_id=c AND pc.business_unit_id=b
 )
 SELECT coalesce(jsonb_agg(data ORDER BY id),'[]'::jsonb) INTO result FROM enriched;
 IF jsonb_array_length(result)<>expected_count
 THEN RAISE EXCEPTION 'Financial page incomplete. No estimated amounts returned'; END IF;
 RETURN jsonb_build_object('rows',result,'permissions',jsonb_build_object('customer',cv,'supplier',sv));
END
$fn$;
REVOKE ALL ON FUNCTION public.transport_register_financial_recovery_page(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_register_financial_recovery_page(uuid[]) TO authenticated;