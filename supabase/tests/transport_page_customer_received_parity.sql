-- Read-only parity check. Execute with a real authenticated Transport session
-- and active Company/BU/location; NEVER manufacture a production auth session.
-- Tests only posted customer documents with no active refunds; other cases remain
-- unsupported by the incremental helper and must retain canonical financial logic.
DO $$
DECLARE mismatch_count integer; tested_count integer;
BEGIN
 IF auth.uid() IS NULL OR public.current_company_id() IS NULL
   OR NOT public.transport_financial_read_allowed('customer') THEN
   RAISE EXCEPTION 'Run as authenticated customer-finance reader in active workspace';
 END IF;
 WITH chosen AS MATERIALIZED (
   SELECT t.id FROM public.transport_trips t
   WHERE t.company_id=public.current_company_id()
     AND t.business_unit_id=public.current_business_unit_id()
     AND t.operating_location_id=public.current_operating_location_id()
   ORDER BY t.trip_date DESC,t.id LIMIT 100 OFFSET 10000
 ), scoped AS MATERIALIZED (
   SELECT * FROM public.transport_register_page_customer_received(
     ARRAY(SELECT id FROM chosen)
   )
 ), compared AS (
   SELECT c.id,coalesce(s.received_gross,0) computed,
          coalesce(f.customer_received_gross,0) expected
   FROM chosen c JOIN public.transport_financial_register f ON f.id=c.id
   LEFT JOIN scoped s ON s.trip_id=c.id
   WHERE EXISTS (SELECT 1 FROM public.transport_customer_document_trips l WHERE l.trip_id=c.id)
     AND NOT EXISTS (
       SELECT 1 FROM public.transport_customer_document_trips l
       JOIN public.transport_customer_documents d ON d.id=l.document_id
       JOIN public.transport_service_refunds r ON r.side='customer'
         AND r.order_id=d.sales_order_id
       JOIN public.transport_active_journals j ON j.id=r.journal_entry_id
       WHERE l.trip_id=c.id
     )
 )
 SELECT count(*),count(*) FILTER(WHERE abs(computed-expected)>0.005)
 INTO tested_count,mismatch_count FROM compared;
 IF tested_count=0 THEN RAISE EXCEPTION 'No eligible customer document rows tested'; END IF;
 IF mismatch_count<>0 THEN
   RAISE EXCEPTION 'Customer receipt helper mismatch on % of % Trips',mismatch_count,tested_count;
 END IF;
 RAISE NOTICE 'Customer receipt parity passed on % Trips',tested_count;
END $$;
