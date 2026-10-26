BEGIN;

CREATE OR REPLACE FUNCTION public.transport_admin_release_debited_supplier_trip_invoice(
  p_order_id uuid,p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $function$
DECLARE
  v_order public.purchase_orders%ROWTYPE;
  v_document public.transport_supplier_documents%ROWTYPE;
  v_link public.transport_supplier_document_rents%ROWTYPE;
  v_balance public.transport_service_document_balances%ROWTYPE;
  v_trip_no text;
BEGIN
  IF auth.uid() IS NULL OR NOT navilo_private.transport_invoice_admin_access() THEN
    RAISE EXCEPTION 'Active company Admin permission required';
  END IF;
  IF p_order_id IS NULL OR length(btrim(coalesce(p_reason,'')))<10 THEN
    RAISE EXCEPTION 'A posted invoice and an audit reason of at least 10 characters are required';
  END IF;

  SELECT * INTO v_order FROM public.purchase_orders p
   WHERE p.id=p_order_id AND p.company_id=public.current_company_id()
     AND p.business_unit_id=public.current_business_unit_id()
     AND p.operating_location_id=public.current_operating_location_id()
   FOR UPDATE;
  IF NOT FOUND OR v_order.status<>'posted' OR v_order.document_kind<>'service' THEN
    RAISE EXCEPTION 'Posted Transport supplier service invoice in the active workspace required';
  END IF;

  SELECT * INTO v_document FROM public.transport_supplier_documents d
   WHERE d.purchase_order_id=v_order.id AND d.company_id=v_order.company_id
     AND d.business_unit_id=v_order.business_unit_id
     AND d.operating_location_id=v_order.operating_location_id FOR UPDATE;
  IF NOT FOUND OR v_document.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Posted Trip Register supplier invoice is required';
  END IF;

  IF (SELECT count(*) FROM public.transport_supplier_document_rents l WHERE l.document_id=v_document.id)<>1
     OR (SELECT count(*) FROM public.purchase_service_lines l WHERE l.order_id=v_order.id)<>1
     OR EXISTS(SELECT 1 FROM public.purchase_order_charges c WHERE c.order_id=v_order.id)
     OR EXISTS(SELECT 1 FROM public.purchase_order_lines l WHERE l.order_id=v_order.id)
     OR EXISTS(SELECT 1 FROM public.transport_service_cost_links l WHERE l.purchase_order_id=v_order.id)
     OR EXISTS(SELECT 1 FROM public.purchase_payment_allocations a WHERE a.purchase_order_id=v_order.id)
     OR EXISTS(SELECT 1 FROM public.transport_service_refunds r WHERE r.side='supplier' AND r.order_id=v_order.id) THEN
    RAISE EXCEPTION 'Only a single-rent invoice without charges, other linked costs, payments, or refunds can be released';
  END IF;

  SELECT * INTO v_link FROM public.transport_supplier_document_rents l
   WHERE l.document_id=v_document.id FOR UPDATE;
  IF NOT FOUND OR v_link.is_adjustment THEN
    RAISE EXCEPTION 'Active supplier Trip Register invoice link not found';
  END IF;

  SELECT * INTO v_balance FROM public.transport_service_document_balances b
   WHERE b.side='supplier' AND b.order_id=v_order.id;
  IF NOT FOUND OR v_balance.original_gross<=0
     OR v_balance.credited_gross<v_balance.original_gross-0.01
     OR v_balance.outstanding_gross>0.01
     OR v_balance.paid_gross>0.01
     OR v_balance.refunded_gross>0.01 THEN
    RAISE EXCEPTION 'The supplier invoice must be fully debited with zero outstanding, payments, and refunds before its Trip link can be released';
  END IF;

  IF NOT EXISTS(SELECT 1 FROM public.transport_trips t WHERE t.id=v_link.trip_id
       AND t.company_id=v_order.company_id AND t.business_unit_id=v_order.business_unit_id
       AND t.operating_location_id=v_order.operating_location_id) THEN
    RAISE EXCEPTION 'Trip and supplier invoice workspace do not match';
  END IF;
  SELECT t.trip_no INTO v_trip_no FROM public.transport_trips t WHERE t.id=v_link.trip_id;

  PERFORM set_config('app.transport_supplier_invoice_trip_release','1',true);
  INSERT INTO public.transport_action_gate(transaction_id,trip_id,action)
   VALUES(txid_current(),v_link.trip_id,'admin_invoice_trip_release');
  UPDATE public.transport_supplier_document_rents SET is_adjustment=true
   WHERE id=v_link.id AND NOT is_adjustment;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplier Trip link release did not update exactly one active link'; END IF;

  INSERT INTO public.owner_posted_control_events(company_id,business_unit_id,document_type,document_id,
      action_type,reason,performed_by,metadata)
  VALUES(v_order.company_id,v_order.business_unit_id,'transport_service_invoice',v_order.id,
    'admin_release_trip_link',btrim(p_reason),auth.uid(),
    jsonb_build_object('side','supplier','invoice_no',v_order.order_no,'trip_id',v_link.trip_id,
      'trip_no',v_trip_no,'document_id',v_document.id,'link_id',v_link.id,
      'debit_gross',v_balance.credited_gross,'original_gross',v_balance.original_gross,
      'outstanding_gross',v_balance.outstanding_gross,'before',to_jsonb(v_link),
      'after',jsonb_set(to_jsonb(v_link),'{is_adjustment}','true'::jsonb)));

  DELETE FROM public.transport_action_gate WHERE transaction_id=txid_current()
    AND trip_id=v_link.trip_id AND action='admin_invoice_trip_release';
  PERFORM set_config('app.transport_supplier_invoice_trip_release','0',true);
  RETURN jsonb_build_object('success',true,'side','supplier','order_id',v_order.id,
    'invoice_no',v_order.order_no,'trip_id',v_link.trip_id,'trip_no',v_trip_no,'released',true);
END
$function$;
REVOKE ALL ON FUNCTION public.transport_admin_release_debited_supplier_trip_invoice(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_admin_release_debited_supplier_trip_invoice(uuid,text) TO authenticated;

-- Extend the append-only evidence gate narrowly for an Admin-verified full
-- supplier debit note. The original invoice, journal, and note stay immutable.
DO $migration$
DECLARE
 v_source text;
 v_at integer;
 v_injection text := $injection$
  if tg_table_name='transport_supplier_document_rents' and tg_op='UPDATE'
    and (to_jsonb(old)->>'is_adjustment')::boolean=false
    and (to_jsonb(new)->>'is_adjustment')::boolean=true
    and (to_jsonb(new)-'is_adjustment')=(to_jsonb(old)-'is_adjustment')
    and coalesce(current_setting('app.transport_supplier_invoice_trip_release',true),'0')='1'
    and exists(
      select 1 from public.transport_action_gate g
      join public.transport_supplier_documents d on d.id=(to_jsonb(old)->>'document_id')::uuid
      join public.purchase_orders o on o.id=d.purchase_order_id
      join public.transport_service_document_balances b on b.order_id=o.id and b.side='supplier'
      where g.transaction_id=txid_current() and g.trip_id=(to_jsonb(old)->>'trip_id')::uuid
        and g.action='admin_invoice_trip_release'
        and o.status='posted' and d.journal_entry_id is not null
        and d.company_id=public.current_company_id()
        and d.business_unit_id=public.current_business_unit_id()
        and d.operating_location_id=public.current_operating_location_id()
        and b.credited_gross>=b.original_gross-0.01
        and b.outstanding_gross<=0.01 and b.paid_gross<=0.01 and b.refunded_gross<=0.01
    ) then return new; end if;
$injection$;
BEGIN
 SELECT p.prosrc INTO v_source FROM pg_proc p
  WHERE p.oid='public.transport_financial_append_only()'::regprocedure;
 v_source:=ltrim(v_source,E' \t\n\r');
 v_at:=strpos(v_source,'begin');
 IF v_at<>1 THEN RAISE EXCEPTION 'Could not locate transport financial evidence trigger insertion point'; END IF;
 IF strpos(v_source,'transport_supplier_invoice_trip_release')=0 THEN
  v_source:=left(v_source,v_at+4)||E'\n'||v_injection||substr(v_source,v_at+5);
  EXECUTE 'CREATE OR REPLACE FUNCTION public.transport_financial_append_only() '
    ||'RETURNS trigger LANGUAGE plpgsql SET search_path TO ''public'', ''pg_temp'' AS '
    ||quote_literal(v_source);
 END IF;
END
$migration$;

NOTIFY pgrst,'reload schema';
COMMIT;
