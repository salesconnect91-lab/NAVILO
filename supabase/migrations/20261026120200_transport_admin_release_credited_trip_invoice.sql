BEGIN;

CREATE OR REPLACE FUNCTION public.transport_admin_release_credited_trip_invoice(
  p_order_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.sales_orders%ROWTYPE;
  v_document public.transport_customer_documents%ROWTYPE;
  v_link public.transport_customer_document_trips%ROWTYPE;
  v_balance public.transport_service_document_balances%ROWTYPE;
  v_trip_no text;
BEGIN
  IF auth.uid() IS NULL OR NOT navilo_private.transport_invoice_admin_access() THEN
    RAISE EXCEPTION 'Active company Admin permission required';
  END IF;
  IF p_order_id IS NULL OR length(btrim(coalesce(p_reason,'')))<10 THEN
    RAISE EXCEPTION 'A posted invoice and an audit reason of at least 10 characters are required';
  END IF;

  SELECT * INTO v_order
    FROM public.sales_orders s
   WHERE s.id=p_order_id
     AND s.company_id=public.current_company_id()
     AND s.business_unit_id=public.current_business_unit_id()
     AND s.operating_location_id=public.current_operating_location_id()
   FOR UPDATE;
  IF NOT FOUND OR v_order.status<>'posted' OR v_order.document_kind<>'service' THEN
    RAISE EXCEPTION 'Posted transport service sales invoice in the active workspace required';
  END IF;

  SELECT * INTO v_document
    FROM public.transport_customer_documents d
   WHERE d.sales_order_id=v_order.id
     AND d.company_id=v_order.company_id
     AND d.business_unit_id=v_order.business_unit_id
     AND d.operating_location_id=v_order.operating_location_id
   FOR UPDATE;
  IF NOT FOUND OR v_document.document_kind<>'credit' OR v_document.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'A posted Trip Register customer service invoice is required';
  END IF;

  IF (SELECT count(*) FROM public.transport_customer_document_trips l
       WHERE l.document_id=v_document.id AND NOT l.is_adjustment)<>1
     OR EXISTS(SELECT 1 FROM public.transport_customer_document_trips l
                WHERE l.document_id=v_document.id AND l.is_adjustment)
     OR (SELECT count(*) FROM public.sales_service_lines l WHERE l.order_id=v_order.id)<>1
     OR EXISTS(SELECT 1 FROM public.sales_order_charges c WHERE c.order_id=v_order.id)
     OR EXISTS(SELECT 1 FROM public.sales_order_lines l WHERE l.order_id=v_order.id)
     OR EXISTS(SELECT 1 FROM public.transport_external_invoice_lines l WHERE l.sales_order_id=v_order.id)
     OR EXISTS(SELECT 1 FROM public.invoice_payment_allocations a WHERE a.sales_order_id=v_order.id)
     OR EXISTS(SELECT 1 FROM public.transport_service_refunds r WHERE r.order_id=v_order.id) THEN
    RAISE EXCEPTION 'Only a single-trip invoice without charges, external lines, payments, or refunds can be released';
  END IF;

  SELECT * INTO v_link
    FROM public.transport_customer_document_trips l
   WHERE l.document_id=v_document.id AND NOT l.is_adjustment
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active Trip Register invoice link not found'; END IF;

  SELECT * INTO v_balance
    FROM public.transport_service_document_balances b
   WHERE b.side='customer' AND b.order_id=v_order.id;
  IF NOT FOUND OR v_balance.original_gross<=0
     OR v_balance.credited_gross<v_balance.original_gross-0.01
     OR v_balance.outstanding_gross>0.01
     OR v_balance.paid_gross>0.01
     OR v_balance.refunded_gross>0.01 THEN
    RAISE EXCEPTION 'The invoice must be fully credited with zero outstanding, payments, and refunds before its Trip link can be released';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.transport_trips t
     WHERE t.id=v_link.trip_id
       AND t.company_id=v_order.company_id
       AND t.business_unit_id=v_order.business_unit_id
       AND t.operating_location_id=v_order.operating_location_id
  ) THEN RAISE EXCEPTION 'Trip and invoice workspace do not match'; END IF;

  SELECT t.trip_no INTO v_trip_no FROM public.transport_trips t WHERE t.id=v_link.trip_id;
  PERFORM set_config('app.transport_invoice_trip_release','1',true);
  INSERT INTO public.transport_action_gate(transaction_id,trip_id,action)
    VALUES(txid_current(),v_link.trip_id,'admin_invoice_trip_release');

  UPDATE public.transport_customer_document_trips
     SET is_adjustment=true
   WHERE id=v_link.id AND NOT is_adjustment;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trip link release did not update exactly one active link'; END IF;

  INSERT INTO public.owner_posted_control_events(
    company_id,business_unit_id,document_type,document_id,action_type,reason,performed_by,metadata
  ) VALUES (
    v_order.company_id,v_order.business_unit_id,'transport_service_invoice',v_order.id,
    'admin_release_trip_link',btrim(p_reason),auth.uid(),
    jsonb_build_object(
      'invoice_no',v_order.order_no,'trip_id',v_link.trip_id,'trip_no',v_trip_no,
      'document_id',v_document.id,'link_id',v_link.id,
      'credit_gross',v_balance.credited_gross,'original_gross',v_balance.original_gross,
      'outstanding_gross',v_balance.outstanding_gross,
      'before',to_jsonb(v_link),'after',jsonb_set(to_jsonb(v_link),'{is_adjustment}','true'::jsonb)
    )
  );

  DELETE FROM public.transport_action_gate
   WHERE transaction_id=txid_current() AND trip_id=v_link.trip_id
     AND action='admin_invoice_trip_release';
  PERFORM set_config('app.transport_invoice_trip_release','0',true);

  RETURN jsonb_build_object('success',true,'order_id',v_order.id,'invoice_no',v_order.order_no,
    'trip_id',v_link.trip_id,'trip_no',v_trip_no,'released',true);
END
$function$;

REVOKE ALL ON FUNCTION public.transport_admin_release_credited_trip_invoice(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transport_admin_release_credited_trip_invoice(uuid,text) TO authenticated;

COMMIT;
