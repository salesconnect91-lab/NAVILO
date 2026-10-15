-- Read-only supplier payment parity across three deterministic Trip pages.
-- Requires authenticated Transport workspace; no production data mutation.
DO $$
DECLARE v_offset integer; v_rows integer; v_mismatches integer;
BEGIN
 IF auth.uid() IS NULL OR public.current_company_id() IS NULL
 OR NOT public.transport_financial_read_allowed('supplier') THEN
   RAISE EXCEPTION 'Authenticated supplier finance workspace required';
 END IF;
 FOREACH v_offset IN ARRAY ARRAY[0,5000,10000] LOOP
   WITH chosen AS MATERIALIZED (
     SELECT id FROM public.transport_trips
     WHERE company_id=public.current_company_id()
       AND business_unit_id=public.current_business_unit_id()
       AND operating_location_id=public.current_operating_location_id()
     ORDER BY trip_date DESC,id LIMIT 100 OFFSET v_offset
   ), links AS MATERIALIZED (
     SELECT l.trip_id,d.purchase_order_id
     FROM chosen c JOIN public.transport_supplier_document_rents l ON l.trip_id=c.id
     JOIN public.transport_supplier_documents d ON d.id=l.document_id
     WHERE NOT l.is_adjustment
   ), orders AS MATERIALIZED (
     SELECT DISTINCT purchase_order_id FROM links
   ), posted AS MATERIALIZED (
     SELECT a.purchase_order_id,sum(a.amount) paid
     FROM orders o JOIN public.purchase_payment_allocations a ON a.purchase_order_id=o.purchase_order_id
     JOIN public.transport_active_journals j ON j.id=a.journal_entry_id
     GROUP BY a.purchase_order_id
   ), historical AS MATERIALIZED (
     SELECT * FROM public.transport_register_page_historical_payments(
       ARRAY(SELECT id FROM chosen)
     )
   ), candidate AS (
     SELECT c.id,
       CASE WHEN l.trip_id IS NULL THEN coalesce(h.paid_gross,0)
            ELSE coalesce(p.paid,0) END computed,
       coalesce(f.payment_amount,0) expected
     FROM chosen c
     JOIN public.transport_financial_register f ON f.id=c.id
     LEFT JOIN links l ON l.trip_id=c.id
     LEFT JOIN posted p ON p.purchase_order_id=l.purchase_order_id
     LEFT JOIN historical h ON h.trip_id=c.id
   )
   SELECT count(*),count(*) FILTER(WHERE abs(computed-expected)>0.005)
     INTO v_rows,v_mismatches FROM candidate;
   IF v_rows<>100 OR v_mismatches<>0 THEN
     RAISE EXCEPTION 'Supplier parity failed at offset %, rows %, mismatches %',
       v_offset,v_rows,v_mismatches;
   END IF;
   RAISE NOTICE 'Supplier payment parity passed for offset %',v_offset;
 END LOOP;
END $$;
