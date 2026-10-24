-- Link a Register service invoice to the exact journal created by the posting
-- engine before calculating its canonical customer/supplier balance.
-- The journal and posted order remain unchanged; this only completes the
-- append-only Transport document evidence that the Register created at draft.

CREATE OR REPLACE FUNCTION public.transport_post_customer_draft(p_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  d public.transport_customer_documents%rowtype;
  o public.sales_orders%rowtype;
  v_result jsonb;
  v_journal_id uuid;
BEGIN
  PERFORM public.transport_finance_assert('billing');
  PERFORM public.assert_module_permission('sales','edit');

  SELECT * INTO d
  FROM public.transport_customer_documents
  WHERE id=p_document_id
    AND company_id=public.current_company_id()
    AND business_unit_id=public.current_business_unit_id()
    AND operating_location_id=public.current_operating_location_id()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft customer invoice not found in active Register'; END IF;

  SELECT * INTO o FROM public.sales_orders WHERE id=d.sales_order_id FOR UPDATE;
  IF o.status IS DISTINCT FROM 'draft' OR d.journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'Customer invoice is already posted or is not a draft';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.transport_customer_document_trips
    WHERE document_id=d.id AND NOT is_adjustment
  ) THEN RAISE EXCEPTION 'Draft invoice has no trips'; END IF;

  INSERT INTO public.transport_action_gate(transaction_id,trip_id,action)
  SELECT txid_current(),l.trip_id,'transport_invoice_post'
  FROM public.transport_customer_document_trips l
  WHERE l.document_id=d.id AND NOT l.is_adjustment
  ON CONFLICT DO NOTHING;

  UPDATE public.sales_service_lines sl
  SET amount=round(coalesce(t.customer_base_rate,t.customer_rate)+coalesce(t.customer_manual_adjustment,0),2),
      description=public.transport_trip_service_description(t.id)
  FROM public.transport_customer_document_trips l
  JOIN public.transport_trips t ON t.id=l.trip_id
  WHERE l.document_id=d.id AND NOT l.is_adjustment
    AND sl.order_id=o.id AND sl.source_module='transport' AND sl.source_id=t.id;

  UPDATE public.transport_customer_document_trips l
  SET rate_snapshot=t.customer_rate_snapshot
  FROM public.transport_trips t
  WHERE l.document_id=d.id AND NOT l.is_adjustment AND t.id=l.trip_id;

  v_result:=public.post_sales_invoice(o.id);
  v_journal_id:=nullif(v_result->>'journal_entry_id','')::uuid;
  IF coalesce((v_result->>'success')::boolean,false) IS NOT TRUE OR v_journal_id IS NULL THEN
    RAISE EXCEPTION 'Sales invoice posting did not return its posted journal';
  END IF;

  UPDATE public.transport_customer_documents
  SET journal_entry_id=v_journal_id
  WHERE id=d.id AND journal_entry_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Could not link the posted journal to the Register invoice'; END IF;

  UPDATE public.transport_customer_document_trips l
  SET vat_snapshot=round(l.vat_snapshot+(
    coalesce((v_result->>'vat')::numeric,0)
    -coalesce((SELECT sum(x.vat_snapshot) FROM public.transport_customer_document_trips x WHERE x.document_id=d.id),0)
  ),2)
  WHERE l.id=(SELECT x.id FROM public.transport_customer_document_trips x WHERE x.document_id=d.id ORDER BY x.id DESC LIMIT 1)
    AND abs(coalesce((v_result->>'vat')::numeric,0)
      -(SELECT coalesce(sum(x.vat_snapshot),0) FROM public.transport_customer_document_trips x WHERE x.document_id=d.id))>=0.005;

  PERFORM public.transport_refresh_document_balance('customer',o.id);
  PERFORM public.transport_financial_audit(
    l.trip_id,'customer_bill_posted',
    v_result||jsonb_build_object('transport_document_id',d.id,'invoice_no',o.order_no,'manual_register_post',true)
  ) FROM public.transport_customer_document_trips l
  WHERE l.document_id=d.id AND NOT l.is_adjustment;

  DELETE FROM public.transport_action_gate
  WHERE transaction_id=txid_current() AND action='transport_invoice_post'
    AND trip_id IN (
      SELECT l.trip_id FROM public.transport_customer_document_trips l
      WHERE l.document_id=d.id
    );

  RETURN v_result||jsonb_build_object('transport_document_id',d.id,'invoice_no',o.order_no,'status','posted');
END;
$function$;

CREATE OR REPLACE FUNCTION public.transport_post_supplier_draft(p_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  d public.transport_supplier_documents%rowtype;
  o public.purchase_orders%rowtype;
  v_result jsonb;
  v_journal_id uuid;
BEGIN
  PERFORM public.transport_finance_assert('rent');
  PERFORM public.assert_module_permission('purchase','edit');

  SELECT * INTO d
  FROM public.transport_supplier_documents
  WHERE id=p_document_id
    AND company_id=public.current_company_id()
    AND business_unit_id=public.current_business_unit_id()
    AND operating_location_id=public.current_operating_location_id()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft supplier invoice not found in active Register'; END IF;

  SELECT * INTO o FROM public.purchase_orders WHERE id=d.purchase_order_id FOR UPDATE;
  IF o.status IS DISTINCT FROM 'draft' OR d.journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'Supplier invoice is already posted or is not a draft';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.transport_supplier_document_rents
    WHERE document_id=d.id AND NOT is_adjustment
  ) THEN RAISE EXCEPTION 'Draft supplier invoice has no trips'; END IF;

  INSERT INTO public.transport_action_gate(transaction_id,trip_id,action)
  SELECT txid_current(),l.trip_id,'transport_invoice_post'
  FROM public.transport_supplier_document_rents l
  WHERE l.document_id=d.id AND NOT l.is_adjustment
  ON CONFLICT DO NOTHING;

  UPDATE public.purchase_service_lines sl
  SET amount=round((
        SELECT coalesce(sum(r.base_amount),sum(r.amount))
        FROM public.transport_supplier_document_rents l2
        JOIN public.transport_trip_supplier_rents r ON r.id=l2.rent_id
        WHERE l2.document_id=d.id AND l2.trip_id=t.id AND NOT l2.is_adjustment
      ),2),
      description=public.transport_trip_service_description(t.id)||' · Supplier rent'
  FROM public.transport_supplier_document_rents l
  JOIN public.transport_trips t ON t.id=l.trip_id
  WHERE l.document_id=d.id AND NOT l.is_adjustment
    AND sl.order_id=o.id AND sl.source_module='transport' AND sl.source_id=t.id;

  UPDATE public.transport_supplier_document_rents l
  SET amount_snapshot=r.finalized_amount_snapshot
  FROM public.transport_trip_supplier_rents r
  WHERE l.document_id=d.id AND NOT l.is_adjustment AND r.id=l.rent_id;

  v_result:=public.post_purchase_invoice(o.id);
  v_journal_id:=nullif(v_result->>'journal_entry_id','')::uuid;
  IF coalesce((v_result->>'success')::boolean,false) IS NOT TRUE OR v_journal_id IS NULL THEN
    RAISE EXCEPTION 'Purchase invoice posting did not return its posted journal';
  END IF;

  UPDATE public.transport_supplier_documents
  SET journal_entry_id=v_journal_id
  WHERE id=d.id AND journal_entry_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Could not link the posted journal to the Register invoice'; END IF;

  UPDATE public.transport_supplier_document_rents l
  SET vat_snapshot=round(l.vat_snapshot+(
    coalesce((v_result->>'vat')::numeric,0)
    -coalesce((SELECT sum(x.vat_snapshot) FROM public.transport_supplier_document_rents x WHERE x.document_id=d.id),0)
  ),2)
  WHERE l.id=(SELECT x.id FROM public.transport_supplier_document_rents x WHERE x.document_id=d.id ORDER BY x.id DESC LIMIT 1)
    AND abs(coalesce((v_result->>'vat')::numeric,0)
      -(SELECT coalesce(sum(x.vat_snapshot),0) FROM public.transport_supplier_document_rents x WHERE x.document_id=d.id))>=0.005;

  PERFORM public.transport_refresh_document_balance('supplier',o.id);
  PERFORM public.transport_financial_audit(
    l.trip_id,'supplier_bill_posted',
    v_result||jsonb_build_object('transport_document_id',d.id,'invoice_no',o.order_no,'manual_register_post',true)
  ) FROM public.transport_supplier_document_rents l
  WHERE l.document_id=d.id AND NOT l.is_adjustment;

  DELETE FROM public.transport_action_gate
  WHERE transaction_id=txid_current() AND action='transport_invoice_post'
    AND trip_id IN (
      SELECT l.trip_id FROM public.transport_supplier_document_rents l
      WHERE l.document_id=d.id
    );

  RETURN v_result||jsonb_build_object('transport_document_id',d.id,'invoice_no',o.order_no,'status','posted');
END;
$function$;

REVOKE ALL ON FUNCTION public.transport_post_customer_draft(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_post_customer_draft(uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.transport_post_supplier_draft(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_post_supplier_draft(uuid) TO authenticated,service_role;

-- Repair only the clearly marked Gondal QA invoice used in the live acceptance
-- session. The exact posted source journal is linked; no journal is inserted,
-- changed, reversed, or deleted.
DO $repair$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT d.id AS document_id,s.id AS order_id,j.id AS journal_id
    FROM public.transport_customer_documents d
    JOIN public.sales_orders s ON s.id=d.sales_order_id
    JOIN public.customers c ON c.id=d.customer_id AND c.company_id=d.company_id
    JOIN public.journal_entries j ON j.source_document_id=s.id
      AND j.source_module='sales' AND j.source_document_type='sales_invoice' AND j.status='posted'
    WHERE s.company_id='bda6d9fe-f530-42f8-8f4d-870a2ef02951'::uuid
      AND s.order_no='QA-CUST-TRIP9-20261024'
      AND c.name='ZZ TEST ONLY NAVILO QA 20261024'
      AND s.status='posted' AND d.journal_entry_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.transport_customer_document_trips l
        WHERE l.document_id=d.id AND NOT l.is_adjustment
      )
  LOOP
    PERFORM set_config('app.maintenance_reset','1',true);
    UPDATE public.transport_customer_documents
    SET journal_entry_id=r.journal_id
    WHERE id=r.document_id AND journal_entry_id IS NULL;
    PERFORM set_config('app.maintenance_reset','0',true);
    PERFORM public.transport_refresh_document_balance('customer',r.order_id);
  END LOOP;
END;
$repair$;

NOTIFY pgrst,'reload schema';
