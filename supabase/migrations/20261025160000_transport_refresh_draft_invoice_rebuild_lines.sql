-- Rebuild Register draft invoice lines from their linked Trips/Rents so charge
-- rows, VAT snapshots, totals, and balances stay in sync after a Refresh action.
CREATE OR REPLACE FUNCTION public.transport_refresh_draft_invoice(
  p_side text,
  p_document_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_order_id uuid;
  v_invoice_no text;
  v_invoice_date date;
  v_account_id uuid;
  v_line_ids uuid[];
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_side='customer' THEN
    PERFORM public.transport_finance_assert('billing');
    PERFORM public.assert_module_permission('sales','edit');
    SELECT d.sales_order_id,o.order_no,o.order_date
      INTO v_order_id,v_invoice_no,v_invoice_date
      FROM public.transport_customer_documents d
      JOIN public.sales_orders o ON o.id=d.sales_order_id
     WHERE d.id=p_document_id
       AND d.company_id=public.current_company_id()
       AND d.business_unit_id=public.current_business_unit_id()
       AND d.operating_location_id=public.current_operating_location_id()
       AND d.journal_entry_id IS NULL AND o.status='draft'
       AND o.document_kind='service' AND o.posted_at IS NULL
     FOR UPDATE OF d,o;
    IF FOUND THEN
      SELECT (SELECT sl.revenue_account_id FROM public.sales_service_lines sl
               WHERE sl.order_id=v_order_id ORDER BY sl.created_at,sl.id LIMIT 1),
             coalesce(array_agg(l.trip_id ORDER BY l.trip_id),'{}'::uuid[])
        INTO v_account_id,v_line_ids
        FROM public.transport_customer_document_trips l
       WHERE l.document_id=p_document_id AND NOT l.is_adjustment;
    END IF;
  ELSIF p_side='supplier' THEN
    PERFORM public.transport_finance_assert('rent');
    PERFORM public.assert_module_permission('purchase','edit');
    SELECT d.purchase_order_id,o.order_no,o.order_date
      INTO v_order_id,v_invoice_no,v_invoice_date
      FROM public.transport_supplier_documents d
      JOIN public.purchase_orders o ON o.id=d.purchase_order_id
     WHERE d.id=p_document_id
       AND d.company_id=public.current_company_id()
       AND d.business_unit_id=public.current_business_unit_id()
       AND d.operating_location_id=public.current_operating_location_id()
       AND d.journal_entry_id IS NULL AND o.status='draft'
       AND o.document_kind='service' AND o.posted_at IS NULL
     FOR UPDATE OF d,o;
    IF FOUND THEN
      SELECT (SELECT sl.cost_account_id FROM public.purchase_service_lines sl
               WHERE sl.order_id=v_order_id ORDER BY sl.created_at,sl.id LIMIT 1),
             coalesce(array_agg(l.rent_id ORDER BY l.rent_id),'{}'::uuid[])
        INTO v_account_id,v_line_ids
        FROM public.transport_supplier_document_rents l
       WHERE l.document_id=p_document_id AND NOT l.is_adjustment;
    END IF;
  ELSE
    RAISE EXCEPTION 'Invoice side must be customer or supplier';
  END IF;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Draft Register invoice not found in active workspace';
  END IF;
  IF cardinality(v_line_ids)=0 THEN
    RAISE EXCEPTION 'Draft invoice has no linked Trips';
  END IF;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Draft invoice has no mapped revenue or expense account';
  END IF;

  v_result:=public.transport_edit_register_draft_invoice(
    p_side,p_document_id,v_line_ids,v_invoice_date,v_invoice_no,v_account_id
  );
  RETURN jsonb_build_object(
    'status','refreshed',
    'order_id',v_order_id,
    'line_count',cardinality(v_line_ids),
    'rebuild',v_result
  );
END
$$;

REVOKE ALL ON FUNCTION public.transport_refresh_draft_invoice(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_refresh_draft_invoice(text,uuid) TO authenticated;
