-- Controlled admin-only in-place edit for an unpaid, single-trip transport sales invoice.
-- The original invoice and journal IDs remain unchanged; no reversal is created.
BEGIN;

-- Read access to the existing append-only action log for the same scoped Admin
-- who is permitted to perform an in-place posted journal correction.
DROP POLICY IF EXISTS owner_posted_control_owner_read ON public.owner_posted_control_events;
CREATE POLICY owner_posted_control_owner_read ON public.owner_posted_control_events
FOR SELECT TO authenticated
USING (
  company_id=public.current_company_id()
  AND business_unit_id=public.current_business_unit_id()
  AND (public.owner_posted_control_access() OR public.company_admin_posted_journal_edit_access())
);

-- A posted service invoice can change only through the scoped RPC below. All
-- other posted sales documents retain the existing immutable behavior.
CREATE OR REPLACE FUNCTION public.prevent_posted_sales_order_changes()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $fn$
BEGIN
  IF coalesce(current_setting('app.maintenance_reset',true),'0')='1'
     AND public.navilo_request_role()='service_role' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status='posted' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Posted sales invoices cannot be deleted.'; END IF;
    IF coalesce(current_setting('app.admin_posted_transport_service_edit',true),'0')='1'
       AND public.company_admin_posted_journal_edit_access()
       AND OLD.document_kind='service'
       AND EXISTS(SELECT 1 FROM public.transport_customer_documents d WHERE d.sales_order_id=OLD.id AND d.journal_entry_id IS NOT NULL)
       AND NEW.status=OLD.status
       AND (to_jsonb(NEW)-ARRAY['total','outstanding_amount','payment_status','updated_at','updated_by'])
           IS NOT DISTINCT FROM
           (to_jsonb(OLD)-ARRAY['total','outstanding_amount','payment_status','updated_at','updated_by']) THEN
      RETURN NEW;
    END IF;
    IF (to_jsonb(NEW)-ARRAY['paid_amount','outstanding_amount','payment_status','updated_at','updated_by'])
       IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['paid_amount','outstanding_amount','payment_status','updated_at','updated_by']) THEN
      RAISE EXCEPTION 'Posted sales invoices are immutable; only the scoped Admin in-place transport edit is allowed.';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$fn$;

-- A posted customer's trip rate remains locked except while the same Admin RPC
-- updates the invoice, the trip rate snapshot, and the existing journal atomically.
CREATE OR REPLACE FUNCTION public.transport_customer_commercial_lock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
  IF public.transport_customer_side_posted(OLD.id)
     AND (NEW.customer_id,NEW.truck_type_id,NEW.from_location_id,NEW.to_location_id,NEW.from_location,NEW.to_location,
          NEW.customer_base_rate,NEW.customer_manual_adjustment,NEW.customer_rate,NEW.customer_rate_snapshot)
         IS DISTINCT FROM
         (OLD.customer_id,OLD.truck_type_id,OLD.from_location_id,OLD.to_location_id,OLD.from_location,OLD.to_location,
          OLD.customer_base_rate,OLD.customer_manual_adjustment,OLD.customer_rate,OLD.customer_rate_snapshot) THEN
    IF coalesce(current_setting('app.admin_posted_transport_service_edit',true),'0')='1'
       AND public.company_admin_posted_journal_edit_access()
       AND (NEW.customer_id,NEW.truck_type_id,NEW.from_location_id,NEW.to_location_id,NEW.from_location,NEW.to_location,NEW.customer_manual_adjustment)
           IS NOT DISTINCT FROM
           (OLD.customer_id,OLD.truck_type_id,OLD.from_location_id,OLD.to_location_id,OLD.from_location,OLD.to_location,OLD.customer_manual_adjustment) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Posted customer billing locks customer, route, truck type, base rate, charges and final customer rate.';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION public.admin_edit_posted_transport_service_invoice(
  p_order_id uuid,
  p_new_amount numeric,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
DECLARE
  v_order public.sales_orders%ROWTYPE;
  v_doc public.transport_customer_documents%ROWTYPE;
  v_link public.transport_customer_document_trips%ROWTYPE;
  v_trip public.transport_trips%ROWTYPE;
  v_line public.sales_service_lines%ROWTYPE;
  v_journal public.journal_entries%ROWTYPE;
  v_ar_id uuid;
  v_revenue_id uuid;
  v_vat_id uuid;
  v_party public.party_ledgers%ROWTYPE;
  v_old_net numeric(18,2);
  v_old_vat numeric(18,2);
  v_new_net numeric(18,2);
  v_new_vat numeric(18,2);
  v_new_gross numeric(18,2);
  v_delta numeric(18,2);
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.company_admin_posted_journal_edit_access() THEN
    RAISE EXCEPTION 'Active company Admin permission required';
  END IF;
  IF p_order_id IS NULL OR p_new_amount IS NULL OR p_new_amount<=0 OR round(p_new_amount,2)<>p_new_amount
     OR length(btrim(coalesce(p_reason,'')))<10 THEN
    RAISE EXCEPTION 'A positive amount to two decimals and an audit reason of at least 10 characters are required';
  END IF;

  SELECT * INTO v_order FROM public.sales_orders s
   WHERE s.id=p_order_id AND s.company_id=public.current_company_id()
     AND s.business_unit_id=public.current_business_unit_id()
     AND s.operating_location_id=public.current_operating_location_id()
   FOR UPDATE;
  IF NOT FOUND OR v_order.status<>'posted' OR v_order.document_kind<>'service' THEN
    RAISE EXCEPTION 'Posted transport service sales invoice in the active workspace required';
  END IF;
  SELECT * INTO v_doc FROM public.transport_customer_documents d
   WHERE d.sales_order_id=v_order.id AND d.company_id=v_order.company_id
     AND d.business_unit_id=v_order.business_unit_id AND d.operating_location_id=v_order.operating_location_id
   FOR UPDATE;
  IF NOT FOUND OR v_doc.document_kind<>'credit' OR v_doc.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Only a posted credit transport service invoice can be edited in place';
  END IF;
  IF v_order.payment_mode IS DISTINCT FROM 'Credit' AND lower(coalesce(v_order.payment_mode,''))<>'credit' THEN
    RAISE EXCEPTION 'Cash hand bills cannot be edited through this path';
  END IF;
  IF coalesce(v_order.paid_amount,0)<>0 OR coalesce(v_order.payment_status,'') NOT IN ('unpaid','')
     OR EXISTS(SELECT 1 FROM public.invoice_payment_allocations a WHERE a.sales_order_id=v_order.id)
     OR EXISTS(SELECT 1 FROM public.transport_service_refunds r WHERE r.order_id=v_order.id)
     OR EXISTS(SELECT 1 FROM public.transport_service_document_balances b WHERE b.side='customer' AND b.order_id=v_order.id AND (coalesce(b.paid_gross,0)<>0 OR coalesce(b.credit_gross,0)<>0)) THEN
    RAISE EXCEPTION 'Invoices with payments, refunds or credits cannot be edited in place';
  END IF;
  IF EXISTS(SELECT 1 FROM public.sales_order_lines WHERE order_id=v_order.id)
     OR EXISTS(SELECT 1 FROM public.sales_order_charges WHERE order_id=v_order.id)
     OR EXISTS(SELECT 1 FROM public.transport_external_invoice_lines WHERE sales_order_id=v_order.id)
     OR EXISTS(SELECT 1 FROM public.return_notes WHERE sales_order_id=v_order.id)
     OR coalesce(public.discount_amount_for('sales_main',v_order.order_no),0)<>0 THEN
    RAISE EXCEPTION 'Inventory, charges, external lines, discounts or credit/debit notes require their own correction workflow';
  END IF;
  IF (SELECT count(*) FROM public.sales_service_lines WHERE order_id=v_order.id)<>1 THEN
    RAISE EXCEPTION 'Only a single-trip, single-line service invoice can be edited in place';
  END IF;
  SELECT * INTO v_line FROM public.sales_service_lines l WHERE l.order_id=v_order.id FOR UPDATE;
  IF v_line.source_module NOT IN ('transport','transport_trip') OR v_line.source_id IS NULL THEN
    RAISE EXCEPTION 'A direct Trip Register service line is required';
  END IF;
  IF (SELECT count(*) FROM public.transport_customer_document_trips l WHERE l.document_id=v_doc.id AND NOT l.is_adjustment)<>1
     OR EXISTS(SELECT 1 FROM public.transport_customer_document_trips l WHERE l.document_id=v_doc.id AND l.is_adjustment) THEN
    RAISE EXCEPTION 'Only a single original Trip link can be edited in place';
  END IF;
  SELECT * INTO v_link FROM public.transport_customer_document_trips l
   WHERE l.document_id=v_doc.id AND l.trip_id=v_line.source_id AND NOT l.is_adjustment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice line and Trip Register link do not match'; END IF;
  SELECT * INTO v_trip FROM public.transport_trips t
   WHERE t.id=v_link.trip_id AND t.company_id=v_order.company_id
     AND t.business_unit_id=v_order.business_unit_id AND t.operating_location_id=v_order.operating_location_id
   FOR UPDATE;
  IF NOT FOUND OR v_trip.customer_id IS DISTINCT FROM v_order.customer_id THEN
    RAISE EXCEPTION 'Trip and invoice customer/workspace do not match';
  END IF;
  SELECT * INTO v_journal FROM public.journal_entries j WHERE j.id=v_doc.journal_entry_id FOR UPDATE;
  IF NOT FOUND OR v_journal.status<>'posted' OR v_journal.company_id<>v_order.company_id
     OR v_journal.business_unit_id<>v_order.business_unit_id OR v_journal.operating_location_id<>v_order.operating_location_id THEN
    RAISE EXCEPTION 'Posted journal does not match the invoice workspace';
  END IF;

  SELECT jl.id INTO v_ar_id FROM public.journal_lines jl JOIN public.chart_of_accounts a ON a.id=jl.account_id
   WHERE jl.entry_id=v_journal.id AND jl.party_type='customer' AND jl.party_id=v_doc.customer_id
     AND jl.debit>0 AND jl.credit=0 AND a.type='asset';
  SELECT jl.id INTO v_revenue_id FROM public.journal_lines jl JOIN public.chart_of_accounts a ON a.id=jl.account_id
   WHERE jl.entry_id=v_journal.id AND jl.account_id=v_line.revenue_account_id AND jl.credit>0 AND jl.debit=0 AND a.type IN ('revenue','income');
  SELECT jl.id INTO v_vat_id FROM public.journal_lines jl JOIN public.chart_of_accounts a ON a.id=jl.account_id
   WHERE jl.entry_id=v_journal.id AND jl.credit>0 AND jl.debit=0 AND a.type='liability'
     AND regexp_replace(lower(a.name),'[^a-z0-9]','','g') LIKE '%vat%';
  IF v_ar_id IS NULL OR v_revenue_id IS NULL OR v_vat_id IS NULL OR
     (SELECT count(*) FROM public.journal_lines WHERE entry_id=v_journal.id)<>3 OR
     (SELECT count(*) FROM public.ledgers WHERE journal_entry_id=v_journal.id)<>3 OR
     EXISTS(SELECT 1 FROM public.journal_lines jl WHERE jl.entry_id=v_journal.id
       AND (SELECT count(*) FROM public.ledgers l WHERE l.journal_entry_id=v_journal.id AND l.journal_line_id=jl.id)<>1) THEN
    RAISE EXCEPTION 'Expected one receivable, one Service Revenue and one Output VAT line with matching ledgers';
  END IF;
  SELECT * INTO v_party FROM public.party_ledgers pl
   WHERE pl.journal_entry_id=v_journal.id AND pl.journal_line_id=v_ar_id
     AND pl.party_type='customer' AND pl.party_id=v_doc.customer_id FOR UPDATE;
  IF NOT FOUND OR (SELECT count(*) FROM public.party_ledgers WHERE journal_entry_id=v_journal.id)<>1 THEN
    RAISE EXCEPTION 'Customer party ledger mapping is incomplete';
  END IF;

  v_old_net:=round(v_line.amount,2);
  v_old_vat:=round(v_link.vat_snapshot,2);
  v_new_net:=round(p_new_amount,2);
  v_new_vat:=round(v_new_net*coalesce(v_line.tax_percent,0)/100,2);
  v_new_gross:=v_new_net+v_new_vat;
  v_delta:=v_new_gross-(v_old_net+v_old_vat);
  IF v_delta=0 THEN RAISE EXCEPTION 'The new amount matches the posted amount'; END IF;
  v_old:=jsonb_build_object(
    'invoice',to_jsonb(v_order),'document',to_jsonb(v_doc),'service_line',to_jsonb(v_line),
    'trip',to_jsonb(v_trip),'trip_link',to_jsonb(v_link),'journal',to_jsonb(v_journal),
    'journal_lines',(SELECT jsonb_agg(to_jsonb(jl) ORDER BY jl.id) FROM public.journal_lines jl WHERE jl.entry_id=v_journal.id),
    'ledgers',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.ledgers l WHERE l.journal_entry_id=v_journal.id),
    'party_ledger',to_jsonb(v_party));

  PERFORM set_config('app.admin_posted_transport_service_edit','1',true);
  PERFORM set_config('app.maintenance_reset','1',true);
  INSERT INTO public.transport_action_gate(transaction_id,trip_id,action)
    VALUES(txid_current(),v_trip.id,'customer_rate_finalize');

  UPDATE public.sales_service_lines SET amount=v_new_net,historical_vat_amount=v_new_vat WHERE id=v_line.id;
  UPDATE public.transport_customer_document_trips SET rate_snapshot=v_new_net,vat_snapshot=v_new_vat WHERE id=v_link.id;
  UPDATE public.transport_trips SET customer_base_rate=v_new_net,customer_rate=v_new_net,customer_rate_snapshot=v_new_net,
    updated_by=auth.uid(),updated_at=now() WHERE id=v_trip.id;
  UPDATE public.sales_orders SET total=v_new_gross,outstanding_amount=v_new_gross,payment_status='unpaid',
    updated_by=auth.uid(),updated_at=now() WHERE id=v_order.id;
  UPDATE public.journal_lines SET debit=v_new_gross,credit=0,base_debit=v_new_gross,base_credit=0,
    source_debit=v_new_gross,source_credit=0 WHERE id=v_ar_id;
  UPDATE public.journal_lines SET debit=0,credit=v_new_net,base_debit=0,base_credit=v_new_net,
    source_debit=0,source_credit=v_new_net WHERE id=v_revenue_id;
  UPDATE public.journal_lines SET debit=0,credit=v_new_vat,base_debit=0,base_credit=v_new_vat,
    source_debit=0,source_credit=v_new_vat WHERE id=v_vat_id;
  UPDATE public.ledgers l SET debit=jl.debit,credit=jl.credit
    FROM public.journal_lines jl WHERE l.journal_entry_id=v_journal.id AND l.journal_line_id=jl.id AND jl.entry_id=v_journal.id;
  UPDATE public.party_ledgers pl SET balance=pl.balance+v_delta
   WHERE pl.company_id=v_order.company_id AND pl.business_unit_id=v_order.business_unit_id
     AND pl.operating_location_id=v_order.operating_location_id AND pl.party_type='customer' AND pl.party_id=v_doc.customer_id
     AND (pl.entry_date,pl.created_at,pl.id) >= (v_party.entry_date,v_party.created_at,v_party.id);
  UPDATE public.party_ledgers SET debit=v_new_gross,credit=0,description='Sales Invoice '||v_order.order_no
   WHERE id=v_party.id;
  DELETE FROM public.transport_action_gate WHERE transaction_id=txid_current() AND trip_id=v_trip.id AND action='customer_rate_finalize';

  SELECT jsonb_build_object(
    'invoice',to_jsonb(s),'service_line',to_jsonb(l),'trip',to_jsonb(t),'trip_link',to_jsonb(dt),
    'journal',to_jsonb(j),'journal_lines',(SELECT jsonb_agg(to_jsonb(jl) ORDER BY jl.id) FROM public.journal_lines jl WHERE jl.entry_id=j.id),
    'ledgers',(SELECT jsonb_agg(to_jsonb(gl) ORDER BY gl.id) FROM public.ledgers gl WHERE gl.journal_entry_id=j.id),
    'party_ledger',(SELECT to_jsonb(pl) FROM public.party_ledgers pl WHERE pl.id=v_party.id))
   INTO v_new
   FROM public.sales_orders s JOIN public.sales_service_lines l ON l.order_id=s.id
   JOIN public.transport_trips t ON t.id=v_trip.id JOIN public.transport_customer_document_trips dt ON dt.id=v_link.id
   JOIN public.journal_entries j ON j.id=v_journal.id WHERE s.id=v_order.id;
  INSERT INTO public.owner_posted_control_events(company_id,business_unit_id,document_type,document_id,action_type,reason,performed_by,metadata)
   VALUES(v_order.company_id,v_order.business_unit_id,'transport_service_invoice',v_order.id,'admin_edit_posted',btrim(p_reason),auth.uid(),
     jsonb_build_object('invoice_no',v_order.order_no,'journal_entry_id',v_journal.id,'trip_id',v_trip.id,'before',v_old,'after',v_new));
  PERFORM set_config('app.admin_posted_transport_service_edit','0',true);
  PERFORM set_config('app.maintenance_reset','0',true);
  RETURN jsonb_build_object('success',true,'order_id',v_order.id,'order_no',v_order.order_no,
    'journal_entry_id',v_journal.id,'net',v_new_net,'vat',v_new_vat,'total',v_new_gross);
END
$fn$;

REVOKE ALL ON FUNCTION public.admin_edit_posted_transport_service_invoice(uuid,numeric,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_edit_posted_transport_service_invoice(uuid,numeric,text) TO authenticated;
COMMENT ON FUNCTION public.admin_edit_posted_transport_service_invoice(uuid,numeric,text) IS
  'Admin-only in-place edit for an unpaid, single-line, single-trip transport sales invoice. Preserves invoice/journal IDs; updates all linked balances atomically and audits before/after.';

NOTIFY pgrst,'reload schema';
COMMIT;
