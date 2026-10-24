-- Keep the one explicitly marked Gondal live QA invoice's payment snapshot in
-- step with its canonical posted Transport document balance. This changes no
-- journal or invoice terms and deliberately does not touch other documents.
DO $repair$
DECLARE
  v_updated integer;
  v_qa_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.sales_orders s
    JOIN public.customers c ON c.id=s.customer_id AND c.company_id=s.company_id
    WHERE s.company_id='bda6d9fe-f530-42f8-8f4d-870a2ef02951'::uuid
      AND s.order_no='QA-CUST-TRIP9-20261024'
      AND c.name='ZZ TEST ONLY NAVILO QA 20261024'
      AND s.status='posted'
  ) INTO v_qa_exists;

  -- This migration runs without an authenticated app session. Bypass only the
  -- row-scope stamp for this exact, pre-validated QA invoice update.
  PERFORM set_config('app.maintenance_reset','1',true);
  UPDATE public.sales_orders s
  SET paid_amount=greatest(b.paid_gross-b.refunded_gross,0),
      outstanding_amount=b.outstanding_gross,
      payment_status=CASE
        WHEN b.credit_gross>0.005 THEN 'overpaid'
        WHEN b.outstanding_gross<=0.005 THEN 'paid'
        WHEN b.paid_gross-b.refunded_gross>0 THEN 'partial'
        ELSE 'unpaid'
      END
  FROM public.transport_service_document_balances b
  JOIN public.transport_customer_documents d ON d.sales_order_id=b.order_id
  JOIN public.customers c ON c.id=d.customer_id AND c.company_id=d.company_id
  WHERE s.id=b.order_id
    AND b.side='customer'
    AND s.company_id='bda6d9fe-f530-42f8-8f4d-870a2ef02951'::uuid
    AND s.order_no='QA-CUST-TRIP9-20261024'
    AND c.name='ZZ TEST ONLY NAVILO QA 20261024'
    AND s.status='posted'
    AND d.journal_entry_id IS NOT NULL;
  GET DIAGNOSTICS v_updated=ROW_COUNT;
  PERFORM set_config('app.maintenance_reset','0',true);

  IF v_qa_exists AND v_updated<>1 THEN
    RAISE EXCEPTION 'Expected to reconcile exactly one marked QA invoice; updated % rows',v_updated;
  END IF;
END;
$repair$;
