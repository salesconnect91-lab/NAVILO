CREATE OR REPLACE FUNCTION public.transport_admin_delete_trip_cascade(p_trip_id uuid, p_reason text, p_confirmation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'navilo_private', 'pg_temp'
AS $function$
DECLARE
  t public.transport_trips%ROWTYPE;
  x record;
  n record;
  v_gate text:=coalesce(current_setting('app.maintenance_reset',true),'');
  v_docs jsonb:='[]'::jsonb;
  v_notes jsonb:='[]'::jsonb;
  v_trip_snapshot jsonb;
  v_link_snapshot jsonb;
  v_rows integer;
BEGIN
  IF auth.uid() IS NULL OR NOT navilo_private.transport_invoice_admin_access() THEN
    RAISE EXCEPTION 'Active company/business-unit Admin required';
  END IF;
  IF p_trip_id IS NULL OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'Trip and audit reason of 10 to 1000 characters required';
  END IF;
  IF NOT public.has_transport_action_permission(public.current_company_id(),'trip_delete') THEN
    RAISE EXCEPTION 'Trip delete permission required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('transport_trip_delete:'||p_trip_id::text,0));
  SELECT * INTO t FROM public.transport_trips
   WHERE id=p_trip_id AND company_id=public.current_company_id()
     AND business_unit_id=public.current_business_unit_id()
     AND operating_location_id=public.current_operating_location_id()
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trip not found in active company, Business Unit and branch'; END IF;
  IF p_confirmation IS DISTINCT FROM 'DELETE '||t.trip_no THEN
    RAISE EXCEPTION 'Type DELETE % to confirm permanent deletion',t.trip_no;
  END IF;
  IF t.status IS DISTINCT FROM 'draft'
     OR public.transport_canonical_trip_status(t.id,false,false,0,0) NOT IN ('draft','incomplete','complete') THEN
    RAISE EXCEPTION 'Trip must be Draft, Incomplete or Complete before it can be deleted';
  END IF;

  -- First log immutable rate evidence and the released-credit link state.
  INSERT INTO public.owner_posted_control_events(company_id,business_unit_id,document_type,document_id,action_type,reason,performed_by,metadata)
  SELECT a.company_id,a.business_unit_id,'transport_trip_rate_adjustment',a.id,'permanent_delete_with_trip',
         btrim(p_reason),auth.uid(),to_jsonb(a)
    FROM public.transport_rate_adjustments a WHERE a.trip_id=t.id;
  FOR x IN
    SELECT DISTINCT l.document_id,l.trip_id,l.is_adjustment,d.sales_order_id order_id,o.order_no invoice_no
      FROM public.transport_customer_document_trips l
      JOIN public.transport_customer_documents d ON d.id=l.document_id
      JOIN public.sales_orders o ON o.id=d.sales_order_id
     WHERE l.trip_id=t.id AND l.is_adjustment
  LOOP
    INSERT INTO public.owner_posted_control_events(company_id,business_unit_id,document_type,document_id,action_type,reason,performed_by,metadata)
    VALUES(t.company_id,t.business_unit_id,'transport_customer_document_trip',x.document_id,
      'permanent_delete_with_trip',btrim(p_reason),auth.uid(),
      jsonb_build_object('trip_id',x.trip_id,'invoice_no',x.invoice_no,'before',to_jsonb(x),'reason',btrim(p_reason)));
  END LOOP;

  -- Only direct, posted, single-Trip service invoices can be removed. The existing
  -- invoice-control routine checks payments, periods, conversions and all GL dependents.
  FOR x IN
    SELECT DISTINCT 'customer'::text side,o.id order_id,o.order_no invoice_no,d.id document_id,
           (SELECT count(*) FROM public.transport_customer_document_trips z WHERE z.document_id=d.id) link_count
      FROM public.transport_customer_document_trips l
      JOIN public.transport_customer_documents d ON d.id=l.document_id
      JOIN public.sales_orders o ON o.id=d.sales_order_id
     WHERE l.trip_id=t.id
    UNION ALL
    SELECT DISTINCT 'supplier',o.id,o.order_no,d.id,
           (SELECT count(*) FROM public.transport_supplier_document_rents z WHERE z.document_id=d.id)
      FROM public.transport_supplier_document_rents l
      JOIN public.transport_supplier_documents d ON d.id=l.document_id
      JOIN public.purchase_orders o ON o.id=d.purchase_order_id
     WHERE l.trip_id=t.id
  LOOP
    IF x.link_count<>1 THEN RAISE EXCEPTION 'Invoice % is linked to multiple Trips; remove that shared link first',x.invoice_no; END IF;
    PERFORM public.assert_module_permission(CASE WHEN x.side='customer' THEN 'sales' ELSE 'purchase' END,'delete');

    -- Posted credit notes are removed only when they are service-only, local and
    -- exclusively tied to this invoice. Their complete before-image is retained.
    FOR n IN
      SELECT rn.* FROM public.return_notes rn
       WHERE rn.id IN (SELECT sl.note_id FROM public.transport_service_note_lines sl
                        WHERE sl.side=x.side AND sl.order_id=x.order_id)
       FOR UPDATE
    LOOP
      IF n.status<>'posted' OR n.journal_entry_id IS NULL
         OR n.fbr_invoice_no IS NOT NULL OR n.fbr_uuid IS NOT NULL
         OR n.fbr_qr_payload IS NOT NULL OR n.fbr_verification_url IS NOT NULL
         OR EXISTS(SELECT 1 FROM public.transport_external_credit_allocations a WHERE a.note_id=n.id)
         OR EXISTS(SELECT 1 FROM public.transport_external_note_requests a WHERE a.note_id=n.id)
         OR EXISTS(SELECT 1 FROM public.return_note_lines rl WHERE rl.note_id=n.id)
         OR (SELECT count(*) FROM public.transport_service_note_lines sl2 WHERE sl2.note_id=n.id)<>1
         OR NOT EXISTS(SELECT 1 FROM public.transport_service_note_lines sl2 WHERE sl2.note_id=n.id AND sl2.side=x.side AND sl2.order_id=x.order_id)
      THEN RAISE EXCEPTION 'Credit note % has stock, external, FBR or shared dependencies; correct it first',n.note_no; END IF;
      IF EXISTS(SELECT 1 FROM public.accounting_periods ap
        JOIN public.journal_entries je ON je.id=n.journal_entry_id
        WHERE ap.company_id=n.company_id AND ap.status='closed'
          AND je.entry_date BETWEEN ap.period_start AND ap.period_end) THEN
        RAISE EXCEPTION 'Credit note % is in a closed accounting period',n.note_no;
      END IF;
      PERFORM navilo_private.transport_assert_no_dependents('public.return_notes'::regclass,n.id,
        ARRAY['public.return_note_lines'::regclass,'public.transport_service_note_lines'::regclass]);
      PERFORM navilo_private.transport_assert_no_dependents('public.journal_entries'::regclass,n.journal_entry_id,
        ARRAY['public.journal_lines'::regclass,'public.ledgers'::regclass,'public.party_ledgers'::regclass,'public.return_notes'::regclass]);
      INSERT INTO public.owner_posted_control_events(company_id,business_unit_id,document_type,document_id,action_type,reason,performed_by,metadata)
      VALUES(n.company_id,n.business_unit_id,'transport_credit_note',n.id,'permanent_delete_with_trip',
        btrim(p_reason),auth.uid(),jsonb_build_object('note',to_jsonb(n),
          'note_lines',(SELECT coalesce(jsonb_agg(to_jsonb(z)),'[]'::jsonb) FROM public.return_note_lines z WHERE z.note_id=n.id),
          'service_note_links',(SELECT coalesce(jsonb_agg(to_jsonb(z)),'[]'::jsonb) FROM public.transport_service_note_lines z WHERE z.note_id=n.id),
          'journal',(SELECT to_jsonb(z) FROM public.journal_entries z WHERE z.id=n.journal_entry_id),
          'journal_lines',(SELECT coalesce(jsonb_agg(to_jsonb(z)),'[]'::jsonb) FROM public.journal_lines z WHERE z.entry_id=n.journal_entry_id),
          'ledgers',(SELECT coalesce(jsonb_agg(to_jsonb(z)),'[]'::jsonb) FROM public.ledgers z WHERE z.journal_entry_id=n.journal_entry_id),
          'party_ledgers',(SELECT coalesce(jsonb_agg(to_jsonb(z)),'[]'::jsonb) FROM public.party_ledgers z WHERE z.journal_entry_id=n.journal_entry_id)));
      PERFORM set_config('app.maintenance_reset','1',true);
      DELETE FROM public.transport_service_note_lines WHERE note_id=n.id;
      DELETE FROM public.return_note_lines WHERE note_id=n.id;
      DELETE FROM public.party_ledgers WHERE journal_entry_id=n.journal_entry_id;
      DELETE FROM public.ledgers WHERE journal_entry_id=n.journal_entry_id;
      DELETE FROM public.journal_lines WHERE entry_id=n.journal_entry_id;
      DELETE FROM public.return_notes WHERE id=n.id;
      DELETE FROM public.journal_entries WHERE id=n.journal_entry_id;
      PERFORM set_config('app.maintenance_reset',v_gate,true);
    END LOOP;

    -- Convert a prior credit-release marker back to an ordinary link only inside
    -- this audited maintenance transaction; invoice control then removes it.
    PERFORM set_config('app.maintenance_reset','1',true);
    UPDATE public.transport_customer_document_trips SET is_adjustment=false
     WHERE document_id=x.document_id AND is_adjustment;
    UPDATE public.transport_supplier_document_rents SET is_adjustment=false
     WHERE document_id=x.document_id AND is_adjustment;
    PERFORM set_config('app.maintenance_reset',v_gate,true);

    IF x.side='customer' THEN
      PERFORM public.transport_admin_delete_posted_invoice('customer',x.order_id,btrim(p_reason));
    ELSE
      PERFORM public.transport_admin_delete_posted_invoice('supplier',x.order_id,btrim(p_reason));
    END IF;
  END LOOP;

  SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.side,q.invoice_no),'[]'::jsonb) INTO v_docs
  FROM (
    SELECT 'customer'::text side,o.order_no invoice_no,o.total
      FROM public.transport_customer_document_trips l
      JOIN public.transport_customer_documents d ON d.id=l.document_id
      JOIN public.sales_orders o ON o.id=d.sales_order_id WHERE l.trip_id=t.id
    UNION ALL
    SELECT 'supplier',o.order_no,o.total
      FROM public.transport_supplier_document_rents l
      JOIN public.transport_supplier_documents d ON d.id=l.document_id
      JOIN public.purchase_orders o ON o.id=d.purchase_order_id WHERE l.trip_id=t.id
  ) q;
  IF jsonb_array_length(v_docs)>0 THEN RAISE EXCEPTION 'Linked invoice cleanup was incomplete'; END IF;

  PERFORM set_config('app.maintenance_reset','1',true);
  DELETE FROM public.transport_rate_adjustments WHERE trip_id=t.id;
  PERFORM set_config('app.maintenance_reset',v_gate,true);

  v_trip_snapshot:=to_jsonb(t);
  SELECT public.transport_delete_draft_trip(t.id,btrim(p_reason)) INTO v_trip_snapshot;
  RETURN jsonb_build_object('deleted',true,'trip_no',t.trip_no,
    'deleted_invoices',(SELECT coalesce(jsonb_agg(jsonb_build_object('side',q.side,'invoice_no',q.invoice_no,'total',q.total)),'[]'::jsonb)
       FROM (
         SELECT 'customer'::text side,o.order_no invoice_no,o.total FROM public.owner_posted_control_events e
           JOIN public.sales_orders o ON false
          WHERE false
       ) q),
    'audit_retained',true);
END
$function$

