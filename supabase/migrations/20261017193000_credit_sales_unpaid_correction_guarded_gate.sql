-- NAVILO Transport Credit Sales: immutable historical correction authorization gate.
-- This is a STRICTLY READ-ONLY execution gate. It does not reverse or unlink records.
-- Future service-only correction must call this inside its write transaction AFTER locking target records.
CREATE OR REPLACE FUNCTION public.transport_credit_hs_unpaid_correction_gate(p_sales_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $fn$
DECLARE
  c uuid:=public.current_company_id();
  b uuid:=public.current_business_unit_id();
  p record;
  j record;
  linked_count integer;
BEGIN
  IF c IS NULL OR b IS NULL THEN RAISE EXCEPTION 'Active Company and Business Unit required'; END IF;
  PERFORM public.assert_module_permission('sales','post');
  SELECT * INTO p FROM public.transport_credit_hs_correction_preflight(c)
    WHERE sales_order_id=p_sales_order_id;
  IF NOT FOUND OR p.review_lane<>'UNPAID_CORRECTION_CANDIDATE' THEN
    RAISE EXCEPTION 'Not an eligible unpaid historical Credit Sales invoice';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sales_orders s WHERE s.id=p_sales_order_id AND s.company_id=c AND s.business_unit_id=b AND s.status='posted') THEN
    RAISE EXCEPTION 'Posted Sales invoice in active workspace required';
  END IF;
  SELECT * INTO j FROM public.transport_credit_hs_journal_pair_review(c)
    WHERE sales_order_id=p_sales_order_id AND verdict='BALANCED_PAIR_REVIEWED';
  IF NOT FOUND THEN RAISE EXCEPTION 'Sales and Opening journal reconciliation has not passed'; END IF;
  SELECT count(*) INTO linked_count FROM public.transport_customer_documents d
    JOIN public.transport_customer_document_trips l ON l.document_id=d.id AND NOT l.is_adjustment
    JOIN public.transport_trips t ON t.id=l.trip_id
    WHERE d.sales_order_id=p_sales_order_id AND t.company_id=c AND t.business_unit_id=b AND t.sale_type='credit'
      AND t.customer_rate_state='finalized';
  IF linked_count<>p.trip_count OR linked_count<>1 THEN
    RAISE EXCEPTION 'Unexpected Trip linkage; manual review required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.invoice_payment_allocations a WHERE a.sales_order_id=p_sales_order_id)
    OR EXISTS (SELECT 1 FROM public.transport_service_note_lines n WHERE n.side='customer' AND n.order_id=p_sales_order_id)
    OR EXISTS (SELECT 1 FROM public.journal_entries rev WHERE rev.reversal_of_entry_id IN(j.sales_journal_id,j.opening_journal_id) AND rev.status='posted')
  THEN RAISE EXCEPTION 'Invoice has settlement or correction evidence; manual review required'; END IF;
  RETURN jsonb_build_object('eligible',true,'invoice_id',p_sales_order_id,'trip_count',p.trip_count,
    'gross',p.total,'sales_journal_id',j.sales_journal_id,'opening_journal_id',j.opening_journal_id,
    'status','READ_ONLY_PREFLIGHT_NO_CORRECTION_APPLIED');
END
$fn$;
REVOKE ALL ON FUNCTION public.transport_credit_hs_unpaid_correction_gate(uuid) FROM PUBLIC, anon, authenticated;
