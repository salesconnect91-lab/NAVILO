-- Fully credited and released customer invoice links must not keep a Trip locked.
-- Supplier lock projection already ignores adjustment links; make customer parity.
DO $migration$
DECLARE
 v_definition text:=pg_get_viewdef('public.transport_trip_financial_summary'::regclass,true);
 v_start integer; v_end integer; v_segment text;
 v_old text:='WHERE o.status = ''posted''::text AND b.billed_gross > 0.005';
 v_new text:='WHERE NOT l.is_adjustment AND o.status = ''posted''::text AND b.billed_gross > 0.005';
BEGIN
 v_start:=strpos(v_definition,'customer_link_flags AS MATERIALIZED (');
 IF v_start=0 THEN RAISE EXCEPTION 'customer_link_flags CTE not found; inspect financial summary before changing locks'; END IF;
 v_end:=strpos(substring(v_definition from v_start),'supplier_link_flags AS MATERIALIZED (');
 IF v_end=0 THEN RAISE EXCEPTION 'supplier_link_flags CTE not found; inspect financial summary before changing locks'; END IF;
 v_segment:=substring(v_definition from v_start for v_end-1);
 IF strpos(v_segment,v_old)=0 THEN RAISE EXCEPTION 'Expected customer lock predicate not found; no view change applied'; END IF;
 v_segment:=replace(v_segment,v_old,v_new);
 v_definition:=overlay(v_definition placing v_segment from v_start for char_length(v_segment));
 EXECUTE 'CREATE OR REPLACE VIEW public.transport_trip_financial_summary AS '||v_definition;
END
$migration$;

-- Rebuild derived snapshots only in companies that have released adjustment
-- links; each business unit/location is rebuilt lazily on its next Register read.
UPDATE public.transport_register_snapshots s
SET built=false,refreshed_at=NULL
WHERE s.company_id IN (
 SELECT DISTINCT t.company_id
 FROM public.transport_trips t
 JOIN public.transport_customer_document_trips l ON l.trip_id=t.id AND l.is_adjustment
 JOIN public.transport_customer_documents d ON d.id=l.document_id
 JOIN public.sales_orders o ON o.id=d.sales_order_id AND o.status='posted'
);
