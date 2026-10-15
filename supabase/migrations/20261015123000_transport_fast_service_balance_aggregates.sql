-- NAVILO: Exact-preserving set-based aggregation of service-note,
-- customer/supplier payment and refund events for Transport register.
-- Original canonical views remain unchanged for other modules.
DO $migration$
DECLARE
  source_view text:=pg_get_viewdef('public.transport_service_document_balances'::regclass,true);
  parent_view text:=pg_get_viewdef('public.transport_trip_financial_summary'::regclass,true);
  first_half text;
  rest text;
  new_source text;
  old_rows jsonb;
  new_rows jsonb;
  samples uuid[];
  new_joins text:=$joins$
  FROM sources s
  LEFT JOIN note_totals n ON n.side=s.side AND n.order_id=s.order_id
  LEFT JOIN payment_totals a ON a.side=s.side AND a.order_id=s.order_id
  LEFT JOIN refund_totals f ON f.side=s.side AND f.order_id=s.order_id
$joins$;
  grouped_ctes text:=$ctes$
), note_totals AS MATERIALIZED (
 SELECT n.side,n.order_id,sum(n.net_amount) AS net,
        sum(n.net_amount+n.vat_amount) AS gross
 FROM public.transport_service_note_lines n
 JOIN public.return_notes rn ON rn.id=n.note_id
 JOIN public.transport_active_journals j ON j.id=rn.journal_entry_id
 WHERE rn.status='posted'
 GROUP BY n.side,n.order_id
), payment_rows AS MATERIALIZED (
 SELECT 'customer'::text AS side,a.sales_order_id AS order_id,
        a.amount,a.allocation_date
 FROM public.invoice_payment_allocations a
 JOIN public.transport_active_journals j ON j.id=a.journal_entry_id
 UNION ALL
 SELECT 'supplier'::text,a.purchase_order_id,a.amount,a.allocation_date
 FROM public.purchase_payment_allocations a
 JOIN public.transport_active_journals j ON j.id=a.journal_entry_id
), payment_totals AS MATERIALIZED (
 SELECT side,order_id,sum(amount) AS paid,max(allocation_date) AS last_date
 FROM payment_rows
 GROUP BY side,order_id
), refund_totals AS MATERIALIZED (
 SELECT f.side,f.order_id,sum(f.amount) AS refunded
 FROM public.transport_service_refunds f
 JOIN public.transport_active_journals j ON j.id=f.journal_entry_id
 GROUP BY f.side,f.order_id
), amounts AS (
$ctes$;
BEGIN
 IF position('transport_service_document_balances_fast' IN parent_view)>0
    AND to_regclass('public.transport_service_document_balances_fast') IS NOT NULL
 THEN
   RAISE NOTICE 'Set-based service balance aggregation already active';
   RETURN;
 END IF;
 IF position('), amounts AS (' IN source_view)=0 OR
    position('FROM sources s' IN source_view)=0 OR
    position(E'\n        )\n SELECT side,' IN source_view)=0 OR
    position('FROM transport_service_document_balances' IN parent_view)=0
 THEN RAISE EXCEPTION 'Canonical financial source changed; cannot safely optimize'; END IF;
 SELECT array_agg(id) INTO samples FROM (
   (SELECT id FROM public.transport_trips ORDER BY trip_date DESC,id LIMIT 8)
   UNION (SELECT id FROM public.transport_trips ORDER BY trip_date,id LIMIT 8)
   UNION (SELECT t.id FROM public.transport_trips t
          WHERE EXISTS (SELECT 1 FROM public.transport_supplier_document_rents d WHERE d.trip_id=t.id)
          ORDER BY t.trip_date DESC,t.id LIMIT 8)
   UNION (SELECT t.id FROM public.transport_trips t
          WHERE EXISTS (SELECT 1 FROM public.transport_customer_document_trips d WHERE d.trip_id=t.id)
          ORDER BY t.trip_date DESC,t.id LIMIT 8)
 ) sample;
 SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) INTO old_rows
 FROM (SELECT * FROM public.transport_trip_financial_summary WHERE id=ANY(samples)) x;
 first_half:=left(source_view,position('), amounts AS (' IN source_view)-1);
 rest:=substr(source_view,position('), amounts AS (' IN source_view)+length('), amounts AS ('));
 new_source:=first_half||grouped_ctes||
   left(rest,position('FROM sources s' IN rest)-1)||
   new_joins||
   substr(rest,position(E'\n        )\n SELECT side,' IN rest));
 EXECUTE 'CREATE OR REPLACE VIEW public.transport_service_document_balances_fast AS '||new_source;
 parent_view:=replace(parent_view,
   'FROM transport_service_document_balances',
   'FROM public.transport_service_document_balances_fast transport_service_document_balances');
 EXECUTE 'CREATE OR REPLACE VIEW public.transport_trip_financial_summary AS '||parent_view;
 SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) INTO new_rows
 FROM (SELECT * FROM public.transport_trip_financial_summary WHERE id=ANY(samples)) x;
 IF old_rows IS DISTINCT FROM new_rows THEN
   RAISE EXCEPTION 'Financial statement parity mismatch: rollback';
 END IF;
 RAISE NOTICE 'Parity checked % Trip summaries',array_length(samples,1);
END;
$migration$;