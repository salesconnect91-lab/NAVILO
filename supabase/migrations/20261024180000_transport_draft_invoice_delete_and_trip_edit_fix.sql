-- Repair two Register workflow regressions without weakening posted controls:
-- 1) Draft Transport invoice deletion must pass the existing scoped delete gates.
-- 2) A draft supplier invoice is not posted evidence, and a legacy rent row with
--    NULL base_amount must compare against its stored amount before correction.
BEGIN;

CREATE TABLE IF NOT EXISTS public.purchase_draft_delete_gate (
  transaction_id bigint NOT NULL,
  purchase_order_id uuid NOT NULL,
  company_id uuid NOT NULL,
  business_unit_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  PRIMARY KEY (transaction_id, purchase_order_id)
);
REVOKE ALL ON public.purchase_draft_delete_gate FROM public, anon, authenticated;
ALTER TABLE public.purchase_draft_delete_gate ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.purchase_draft_delete_gate_allows(
  p_order_id uuid, p_company_id uuid, p_business_unit_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND p_company_id = public.current_company_id()
    AND p_business_unit_id = public.current_business_unit_id()
    AND public.has_module_permission(p_company_id, 'purchase', 'delete')
    AND EXISTS (
      SELECT 1
      FROM public.purchase_draft_delete_gate g
      JOIN public.purchase_orders o ON o.id = g.purchase_order_id
      WHERE g.transaction_id = txid_current()
        AND g.purchase_order_id = p_order_id
        AND g.company_id = p_company_id
        AND g.business_unit_id = p_business_unit_id
        AND g.requested_by = auth.uid()
        AND o.company_id = p_company_id
        AND o.business_unit_id = p_business_unit_id
        AND o.operating_location_id = public.current_operating_location_id()
        AND o.status = 'draft'
        AND o.posted_at IS NULL
    );
$function$;
REVOKE ALL ON FUNCTION public.purchase_draft_delete_gate_allows(uuid, uuid, uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_service_document_line()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  o record;
  v_module text := CASE WHEN tg_table_name = 'sales_service_lines' THEN 'sales' ELSE 'purchase' END;
BEGIN
  -- DELETE is handled before touching NEW; only an authenticated, scoped draft
  -- deletion gate can release append-only service-line history.
  IF tg_op = 'DELETE' THEN
    IF coalesce(current_setting('app.maintenance_reset', true), '0') = '1' THEN RETURN old; END IF;
    IF tg_table_name = 'sales_service_lines'
       AND public.sales_draft_delete_gate_allows(old.order_id, old.company_id, old.business_unit_id) THEN
      RETURN old;
    END IF;
    IF tg_table_name = 'purchase_service_lines'
       AND public.purchase_draft_delete_gate_allows(old.order_id, old.company_id, old.business_unit_id) THEN
      RETURN old;
    END IF;
    RAISE EXCEPTION 'Service line history is append-only';
  END IF;

  IF public.transport_register_conversion_allowed(
       new.order_id,
       CASE WHEN tg_table_name = 'sales_service_lines' THEN 'customer' ELSE 'supplier' END
     ) THEN
    IF new.source_module <> 'historical_register'
       OR NOT EXISTS (
         SELECT 1
         FROM public.transport_register_invoice_conversion_lines l
         JOIN public.transport_register_invoice_conversions v ON v.document_id = l.document_id
         WHERE v.order_id = new.order_id
           AND l.trip_id = new.source_id
           AND l.net = new.amount
           AND l.vat = new.historical_vat_amount
           AND l.tax_percent = new.tax_percent
       ) THEN
      RAISE EXCEPTION 'Historical service line must exactly match approved source allocation';
    END IF;
    RETURN new;
  END IF;

  IF tg_table_name IN ('sales_service_lines', 'purchase_service_lines')
     AND new.historical_vat_amount IS NOT NULL THEN
    RAISE EXCEPTION 'Historical VAT snapshot requires controlled conversion';
  END IF;
  IF coalesce(current_setting('app.maintenance_reset', true), '0') = '1' THEN RETURN new; END IF;
  IF new.company_id IS DISTINCT FROM public.current_company_id()
     OR new.business_unit_id IS DISTINCT FROM public.current_business_unit_id()
     OR NOT public.has_module_permission(new.company_id, v_module, CASE WHEN tg_op = 'INSERT' THEN 'create' ELSE 'edit' END) THEN
    RAISE EXCEPTION 'Service line permission or tenant mismatch';
  END IF;

  IF tg_table_name = 'sales_service_lines' THEN
    SELECT company_id, business_unit_id, status, document_kind, invoice_type, tax_percent
      INTO o FROM public.sales_orders WHERE id = new.order_id;
  ELSE
    SELECT company_id, business_unit_id, status, document_kind, invoice_type, tax_percent
      INTO o FROM public.purchase_orders WHERE id = new.order_id;
    IF NOT EXISTS (
      SELECT 1 FROM public.chart_of_accounts a
      WHERE a.id = new.cost_account_id AND a.company_id = new.company_id
        AND a.type = 'expense' AND a.is_active AND NOT a.is_group
    ) THEN RAISE EXCEPTION 'Active company service expense account required'; END IF;
  END IF;

  IF o.company_id IS DISTINCT FROM new.company_id
     OR o.business_unit_id IS DISTINCT FROM new.business_unit_id
     OR o.document_kind <> 'service' OR o.status = 'posted'
     OR new.tax_percent IS DISTINCT FROM (CASE WHEN o.invoice_type = 'Tax Invoice' THEN o.tax_percent ELSE 0 END) THEN
    RAISE EXCEPTION 'Draft service document and tax snapshot required';
  END IF;
  IF tg_op = 'UPDATE'
     AND (to_jsonb(new) - 'description' - 'amount' - 'tax_percent' - 'cost_account_id')
         IS DISTINCT FROM (to_jsonb(old) - 'description' - 'amount' - 'tax_percent' - 'cost_account_id') THEN
    RAISE EXCEPTION 'Service line identity is immutable';
  END IF;
  IF tg_op = 'INSERT' THEN new.created_by := auth.uid(); END IF;
  RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_draft_purchase_invoice(p_order_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_order public.purchase_orders%rowtype;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required.'; END IF;
  SELECT * INTO v_order FROM public.purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_order.company_id IS DISTINCT FROM public.current_company_id() THEN RAISE EXCEPTION 'Purchase Invoice does not belong to the active company.'; END IF;
  IF v_order.business_unit_id IS DISTINCT FROM public.current_business_unit_id() THEN RAISE EXCEPTION 'Purchase Invoice belongs to another business unit.'; END IF;
  IF v_order.operating_location_id IS DISTINCT FROM public.current_operating_location_id() THEN RAISE EXCEPTION 'Purchase Invoice belongs to another branch/location.'; END IF;
  IF lower(coalesce(v_order.status, '')) <> 'draft' OR v_order.posted_at IS NOT NULL THEN RAISE EXCEPTION 'Only unposted draft Purchase Invoices can be deleted.'; END IF;
  IF NOT public.has_module_permission(v_order.company_id, 'purchase', 'delete') THEN RAISE EXCEPTION 'You do not have permission to delete Purchase Invoices.'; END IF;
  IF EXISTS (SELECT 1 FROM public.purchase_payment_allocations x WHERE x.purchase_order_id = p_order_id) THEN RAISE EXCEPTION 'Purchase Invoice has payment allocations and cannot be deleted.'; END IF;
  IF EXISTS (SELECT 1 FROM public.return_notes x WHERE x.purchase_order_id = p_order_id) THEN RAISE EXCEPTION 'Purchase Invoice has return notes and cannot be deleted.'; END IF;
  INSERT INTO public.purchase_draft_delete_gate(transaction_id, purchase_order_id, company_id, business_unit_id, requested_by)
  VALUES (txid_current(), p_order_id, v_order.company_id, v_order.business_unit_id, auth.uid())
  ON CONFLICT (transaction_id, purchase_order_id) DO NOTHING;
  DELETE FROM public.purchase_orders WHERE id = p_order_id AND status = 'draft' AND posted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft changed during delete; nothing was deleted.'; END IF;
  DELETE FROM public.purchase_draft_delete_gate WHERE transaction_id = txid_current() AND purchase_order_id = p_order_id;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.delete_draft_purchase_invoice(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_draft_purchase_invoice(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.transport_delete_register_draft_invoice(p_side text, p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_order_id uuid; v_deleted boolean; v_doc_company uuid; v_doc_bu uuid; v_doc_location uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_side = 'customer' THEN
    PERFORM public.transport_finance_assert('billing');
    SELECT d.sales_order_id, d.company_id, d.business_unit_id, d.operating_location_id
      INTO v_order_id, v_doc_company, v_doc_bu, v_doc_location
      FROM public.transport_customer_documents d
      JOIN public.sales_orders o ON o.id = d.sales_order_id
     WHERE d.id = p_document_id AND d.company_id = public.current_company_id()
       AND d.business_unit_id = public.current_business_unit_id()
       AND d.operating_location_id = public.current_operating_location_id()
       AND d.journal_entry_id IS NULL AND o.status = 'draft' AND o.posted_at IS NULL
       AND o.document_kind = 'service'
     FOR UPDATE OF d, o;
    IF NOT FOUND THEN RAISE EXCEPTION 'Draft customer invoice not found in active Register'; END IF;
    INSERT INTO public.sales_draft_delete_gate(transaction_id, sales_order_id, company_id, business_unit_id, requested_by)
    VALUES (txid_current(), v_order_id, v_doc_company, v_doc_bu, auth.uid())
    ON CONFLICT (transaction_id, sales_order_id) DO NOTHING;
    INSERT INTO public.transport_action_gate(transaction_id, trip_id, action)
      SELECT txid_current(), l.trip_id, 'draft_invoice_delete'
        FROM public.transport_customer_document_trips l WHERE l.document_id = p_document_id
      UNION SELECT txid_current(), p_document_id, 'draft_invoice_delete'
      ON CONFLICT DO NOTHING;
    DELETE FROM public.sales_service_lines WHERE order_id = v_order_id;
    DELETE FROM public.sales_order_charges WHERE order_id = v_order_id;
    DELETE FROM public.transport_customer_document_trips WHERE document_id = p_document_id;
    DELETE FROM public.transport_customer_documents WHERE id = p_document_id;
    DELETE FROM public.sales_draft_delete_gate WHERE transaction_id = txid_current() AND sales_order_id = v_order_id;
    v_deleted := public.delete_draft_sales_invoice(v_order_id);
  ELSIF p_side = 'supplier' THEN
    PERFORM public.transport_finance_assert('rent');
    SELECT d.purchase_order_id, d.company_id, d.business_unit_id, d.operating_location_id
      INTO v_order_id, v_doc_company, v_doc_bu, v_doc_location
      FROM public.transport_supplier_documents d
      JOIN public.purchase_orders o ON o.id = d.purchase_order_id
     WHERE d.id = p_document_id AND d.company_id = public.current_company_id()
       AND d.business_unit_id = public.current_business_unit_id()
       AND d.operating_location_id = public.current_operating_location_id()
       AND d.journal_entry_id IS NULL AND o.status = 'draft' AND o.posted_at IS NULL
       AND o.document_kind = 'service'
     FOR UPDATE OF d, o;
    IF NOT FOUND THEN RAISE EXCEPTION 'Draft supplier invoice not found in active Register'; END IF;
    INSERT INTO public.purchase_draft_delete_gate(transaction_id, purchase_order_id, company_id, business_unit_id, requested_by)
    VALUES (txid_current(), v_order_id, v_doc_company, v_doc_bu, auth.uid())
    ON CONFLICT (transaction_id, purchase_order_id) DO NOTHING;
    INSERT INTO public.transport_action_gate(transaction_id, trip_id, action)
      SELECT txid_current(), l.trip_id, 'draft_invoice_delete'
        FROM public.transport_supplier_document_rents l WHERE l.document_id = p_document_id
      UNION SELECT txid_current(), p_document_id, 'draft_invoice_delete'
      ON CONFLICT DO NOTHING;
    DELETE FROM public.purchase_service_lines WHERE order_id = v_order_id;
    DELETE FROM public.purchase_order_charges WHERE order_id = v_order_id;
    DELETE FROM public.transport_supplier_document_rents WHERE document_id = p_document_id;
    DELETE FROM public.transport_supplier_documents WHERE id = p_document_id;
    DELETE FROM public.purchase_draft_delete_gate WHERE transaction_id = txid_current() AND purchase_order_id = v_order_id;
    v_deleted := public.delete_draft_purchase_invoice(v_order_id);
  ELSE
    RAISE EXCEPTION 'Invoice side must be customer or supplier';
  END IF;
  IF NOT coalesce(v_deleted, false) THEN RAISE EXCEPTION 'Draft invoice could not be deleted'; END IF;
  DELETE FROM public.transport_action_gate WHERE transaction_id = txid_current() AND action = 'draft_invoice_delete';
  RETURN jsonb_build_object('deleted', true, 'document_id', p_document_id, 'side', p_side);
END;
$function$;
REVOKE ALL ON FUNCTION public.transport_delete_register_draft_invoice(text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.transport_delete_register_draft_invoice(text, uuid) TO authenticated;

DO $trip_edit_fix$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef('public.transport_save_operational_trip_edit(uuid,jsonb,uuid,uuid,text)'::regprocedure)
    INTO v_definition;
  v_old := $old$supplier_posted:=exists(select 1 from public.transport_supplier_document_rents
    where trip_id=t.id and not is_adjustment);$old$;
  v_new := $new$supplier_posted:=exists(
    select 1
    from public.transport_supplier_document_rents l
    join public.transport_supplier_documents d on d.id=l.document_id
    join public.purchase_orders o on o.id=d.purchase_order_id
    where l.trip_id=t.id and not l.is_adjustment and o.status='posted'
  );$new$;
  IF position(v_old IN v_definition) = 0 THEN RAISE EXCEPTION 'Expected supplier posted check not found'; END IF;
  v_definition := replace(v_definition, v_old, v_new);
  v_old := 'if new_rent is distinct from (select base_amount from public.transport_trip_supplier_rents where id=rent_id)';
  v_new := 'if new_rent is distinct from (select coalesce(base_amount,amount) from public.transport_trip_supplier_rents where id=rent_id)';
  IF position(v_old IN v_definition) = 0 THEN RAISE EXCEPTION 'Expected supplier rent comparison not found'; END IF;
  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;
END;
$trip_edit_fix$;

NOTIFY pgrst, 'reload schema';
COMMIT;
