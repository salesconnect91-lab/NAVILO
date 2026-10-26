CREATE OR REPLACE FUNCTION public.transport_guard_financial_reversal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if new.reversal_of_entry_id is not null and coalesce(current_setting('app.transport_service_invoice_reversal',true),'') <> '1' and (
 exists(select 1 from public.transport_customer_documents where journal_entry_id=new.reversal_of_entry_id)
 or exists(select 1 from public.transport_supplier_documents where journal_entry_id=new.reversal_of_entry_id)
 or exists(select 1 from public.transport_service_note_lines n join public.return_notes r on r.id=n.note_id where r.journal_entry_id=new.reversal_of_entry_id)
 or exists(select 1 from public.transport_service_refunds where journal_entry_id=new.reversal_of_entry_id))
 then raise exception 'Transport posted billing/credit/refund history is immutable; use controlled rate correction';end if;return new;
end $function$


CREATE OR REPLACE FUNCTION public.transport_reverse_service_invoice(p_side text, p_order_id uuid, p_note_date date, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company uuid:=public.current_company_id();
  v_bu uuid:=public.current_business_unit_id();
  v_loc uuid:=public.current_operating_location_id();
  v_user uuid:=public.legacy_data_user_id();
  v_order record;
  v_source_id uuid;
  v_party_name text;
  v_party_id uuid;
  v_vat_account uuid;
  v_tax numeric(18,2):=0;
  v_net numeric(18,2);
  v_total numeric(18,2);
  v_note uuid:=gen_random_uuid();
  v_journal uuid:=gen_random_uuid();
  v_no text;
  v_line_count integer;
  v_debits numeric(18,2);
  v_credits numeric(18,2);
  v_base_currency text;
  v_post jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL OR v_bu IS NULL OR v_loc IS NULL OR v_user IS NULL
     OR p_order_id IS NULL OR p_note_date IS NULL OR nullif(btrim(coalesce(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Active company, invoice, note date and reason are required.';
  END IF;
  IF p_side='customer' THEN
    PERFORM public.assert_module_permission('sales','post');
    SELECT s.* INTO v_order FROM public.sales_orders s
      JOIN public.transport_customer_documents d ON d.sales_order_id=s.id
      WHERE s.id=p_order_id AND s.company_id=v_company AND s.business_unit_id=v_bu
        AND s.operating_location_id=v_loc AND d.company_id=v_company
        AND d.business_unit_id=v_bu AND d.operating_location_id=v_loc
      FOR UPDATE OF s;
    IF NOT FOUND OR v_order.status<>'posted' OR v_order.document_kind<>'service' THEN
      RAISE EXCEPTION 'Posted Transport Sales Service Invoice in the active workspace required.';
    END IF;
    v_party_id:=v_order.customer_id;
    SELECT d.journal_entry_id,c.name INTO v_source_id,v_party_name
      FROM public.transport_customer_documents d JOIN public.customers c ON c.id=d.customer_id
      WHERE d.sales_order_id=p_order_id AND d.company_id=v_company AND d.business_unit_id=v_bu
        AND d.operating_location_id=v_loc;
    v_vat_account:=public.fx_mapping_account(v_user,v_company,'output_vat','liability');
  ELSIF p_side='supplier' THEN
    PERFORM public.assert_module_permission('purchase','post');
    SELECT p.* INTO v_order FROM public.purchase_orders p
      JOIN public.transport_supplier_documents d ON d.purchase_order_id=p.id
      WHERE p.id=p_order_id AND p.company_id=v_company AND p.business_unit_id=v_bu
        AND p.operating_location_id=v_loc AND d.company_id=v_company
        AND d.business_unit_id=v_bu AND d.operating_location_id=v_loc
      FOR UPDATE OF p;
    IF NOT FOUND OR v_order.status<>'posted' OR v_order.document_kind<>'service' THEN
      RAISE EXCEPTION 'Posted Transport Purchase Service Invoice in the active workspace required.';
    END IF;
    v_party_id:=v_order.supplier_id;
    SELECT d.journal_entry_id,s.name INTO v_source_id,v_party_name
      FROM public.transport_supplier_documents d JOIN public.suppliers s ON s.id=d.supplier_id
      WHERE d.purchase_order_id=p_order_id AND d.company_id=v_company AND d.business_unit_id=v_bu
        AND d.operating_location_id=v_loc;
    v_vat_account:=public.fx_mapping_account(v_user,v_company,'input_vat','asset');
  ELSE
    RAISE EXCEPTION 'Invoice side must be customer or supplier.';
  END IF;
  IF v_source_id IS NULL THEN RAISE EXCEPTION 'Original posted service journal was not found.'; END IF;
  SELECT base_currency_code INTO v_base_currency FROM public.companies WHERE id=v_company;
  IF coalesce(v_order.currency_code,v_base_currency)<>v_base_currency
     OR coalesce(v_order.exchange_rate,1)<>1 THEN
    RAISE EXCEPTION 'Foreign-currency invoices require the FX-specific correction workflow.';
  END IF;
  PERFORM public.assert_module_permission('accounting','post');
  PERFORM 1 FROM public.journal_entries j WHERE j.id=v_source_id AND j.company_id=v_company
    AND j.business_unit_id=v_bu AND j.operating_location_id=v_loc AND j.status='posted'
    AND j.reversal_of_entry_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original posted journal is missing or already reversed.'; END IF;
  IF EXISTS(SELECT 1 FROM public.journal_entries r WHERE r.reversal_of_entry_id=v_source_id AND r.status='posted')
     OR EXISTS(SELECT 1 FROM public.transport_service_note_lines n
       JOIN public.return_notes rn ON rn.id=n.note_id
       JOIN public.transport_active_journals j ON j.id=rn.journal_entry_id
       WHERE n.side=p_side AND n.order_id=p_order_id) THEN
    RAISE EXCEPTION 'This invoice already has a posted credit/debit note or reversal. Use the correction workflow.';
  END IF;
  SELECT count(*),coalesce(sum(debit),0),coalesce(sum(credit),0)
    INTO v_line_count,v_debits,v_credits FROM public.journal_lines
    WHERE entry_id=v_source_id AND company_id=v_company AND business_unit_id=v_bu
      AND operating_location_id=v_loc;
  IF v_line_count=0 OR abs(v_debits-v_credits)>=0.01
     OR abs(v_debits-round(v_order.total,2))>=0.01 THEN
    RAISE EXCEPTION 'Original invoice journal does not reconcile to its posted total; reversal blocked.';
  END IF;
  SELECT coalesce(sum(CASE WHEN p_side='customer' THEN credit-debit ELSE debit-credit END),0)
    INTO v_tax FROM public.journal_lines WHERE entry_id=v_source_id
      AND company_id=v_company AND business_unit_id=v_bu AND account_id=v_vat_account;
  v_total:=round(v_order.total,2);
  IF coalesce(v_order.tax_percent,0)>0 AND (v_vat_account IS NULL OR v_tax<=0) THEN
    RAISE EXCEPTION 'Original VAT mapping or VAT journal line is missing; reversal blocked.';
  END IF;
  v_net:=round(v_total-v_tax,2);
  IF v_net<=0 OR v_tax<0 THEN RAISE EXCEPTION 'Original invoice VAT/net values are invalid; reversal blocked.'; END IF;

  v_no:='TR-SVC-'||CASE WHEN p_side='customer' THEN 'CN-' ELSE 'DN-' END
       ||upper(substr(replace(v_note::text,'-',''),1,16));
  INSERT INTO public.return_notes(
    id,user_id,company_id,business_unit_id,operating_location_id,note_no,note_type,
    sales_order_id,purchase_order_id,party_type,party_id,party_name,note_date,reason,
    status,subtotal,tax_total,total,cost_total
  ) VALUES(
    v_note,v_user,v_company,v_bu,v_loc,v_no,
    CASE WHEN p_side='customer' THEN 'sales_credit' ELSE 'purchase_debit' END,
    CASE WHEN p_side='customer' THEN p_order_id END,
    CASE WHEN p_side='supplier' THEN p_order_id END,
    p_side,v_party_id,
    v_party_name,p_note_date,btrim(p_reason),'draft',v_net,v_tax,v_total,0
  );
  PERFORM set_config('app.transport_service_invoice_reversal','1',true);
  INSERT INTO public.journal_entries(
    id,user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,
    description,status,payment_mode,party_name,trans_type,reversal_of_entry_id,
    reversal_reason,source_module,source_document_type,source_document_id,
    currency_code,exchange_rate,accounting_dimension_id
  ) SELECT v_journal,v_user,v_company,v_bu,v_loc,v_no,p_note_date,
      'Full Transport service invoice reversal: '||btrim(p_reason),'draft',j.payment_mode,
      v_party_name,CASE WHEN p_side='customer' THEN 'Service Sales Credit Note' ELSE 'Service Purchase Debit Note' END,
      v_source_id,btrim(p_reason),p_side,'transport_service_invoice_reversal',v_note,
      j.currency_code,j.exchange_rate,j.accounting_dimension_id
    FROM public.journal_entries j WHERE j.id=v_source_id;
  INSERT INTO public.journal_lines(
    user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,
    debit,credit,party_type,party_id,party_name,amount_basis,accounting_dimension_id,
    transport_vehicle_id,transport_vehicle_no,description
  ) SELECT user_id,company_id,business_unit_id,operating_location_id,v_journal,account_id,account,
      round(coalesce(credit,0),2),round(coalesce(debit,0),2),party_type,party_id,party_name,
      amount_basis,accounting_dimension_id,transport_vehicle_id,transport_vehicle_no,description
    FROM public.journal_lines WHERE entry_id=v_source_id AND company_id=v_company
      AND business_unit_id=v_bu AND operating_location_id=v_loc;
  v_post:=public.post_journal_entry(v_journal);
  IF coalesce(v_post->>'status','')<>'posted' THEN RAISE EXCEPTION 'Full reversal journal did not post.'; END IF;
  UPDATE public.return_notes SET status='posted',journal_entry_id=v_journal,posted_at=now()
    WHERE id=v_note AND company_id=v_company AND business_unit_id=v_bu;
  INSERT INTO public.transport_service_note_lines(
    company_id,business_unit_id,operating_location_id,note_id,side,order_id,net_amount,vat_amount,created_by
  ) VALUES(v_company,v_bu,v_loc,v_note,p_side,p_order_id,v_net,v_tax,auth.uid());
  PERFORM set_config('app.transport_service_invoice_reversal','0',true);
  RETURN jsonb_build_object('success',true,'side',p_side,'order_id',p_order_id,
    'note_id',v_note,'note_no',v_no,'journal_entry_id',v_journal,'source_journal_id',v_source_id,
    'net',v_net,'vat',v_tax,'total',v_total,'post_result',v_post);
END
$function$


CREATE OR REPLACE FUNCTION public.transport_admin_release_credited_trip_invoice(p_order_id uuid, p_reason text)
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
  IF NOT FOUND OR v_document.document_kind NOT IN ('credit','adjustment') OR v_document.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'A posted Trip Register customer service invoice is required';
  END IF;

  IF (SELECT count(*) FROM public.transport_customer_document_trips l
       WHERE l.document_id=v_document.id)<>1
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
   WHERE l.document_id=v_document.id
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
  IF NOT v_link.is_adjustment THEN
    PERFORM set_config('app.transport_invoice_trip_release','1',true);
    INSERT INTO public.transport_action_gate(transaction_id,trip_id,action)
      VALUES(txid_current(),v_link.trip_id,'admin_invoice_trip_release');
    UPDATE public.transport_customer_document_trips SET is_adjustment=true WHERE id=v_link.id AND NOT is_adjustment;
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
  END IF;

  RETURN jsonb_build_object('success',true,'order_id',v_order.id,'invoice_no',v_order.order_no,
    'trip_id',v_link.trip_id,'trip_no',v_trip_no,'released',true);
END
$function$


CREATE OR REPLACE VIEW public.transport_trip_financial_summary AS
 WITH service_balances AS MATERIALIZED (
         SELECT transport_service_document_balances.side,
            transport_service_document_balances.order_id,
            transport_service_document_balances.company_id,
            transport_service_document_balances.business_unit_id,
            transport_service_document_balances.operating_location_id,
            transport_service_document_balances.party_id,
            transport_service_document_balances.order_no,
            transport_service_document_balances.order_date,
            transport_service_document_balances.original_gross,
            transport_service_document_balances.tax_percent,
            transport_service_document_balances.original_net,
            transport_service_document_balances.credited_net,
            transport_service_document_balances.credited_gross,
            transport_service_document_balances.paid_gross,
            transport_service_document_balances.last_payment_date,
            transport_service_document_balances.refunded_gross,
            transport_service_document_balances.billed_net,
            transport_service_document_balances.billed_gross,
            transport_service_document_balances.paid_net,
            transport_service_document_balances.outstanding_gross,
            transport_service_document_balances.credit_gross,
            transport_service_document_balances.outstanding_net
           FROM transport_service_document_balances_fast transport_service_document_balances
        ), customer_line_weights AS MATERIALIZED (
         SELECT l.id,
            l.trip_id,
            d.sales_order_id,
            b.side,
            b.order_id,
            b.company_id,
            b.business_unit_id,
            b.operating_location_id,
            b.party_id,
            b.order_no,
            b.order_date,
            b.original_gross,
            b.tax_percent,
            b.original_net,
            b.credited_net,
            b.credited_gross,
            b.paid_gross,
            b.last_payment_date,
            b.refunded_gross,
            b.billed_net,
            b.billed_gross,
            b.paid_net,
            b.outstanding_gross,
            b.credit_gross,
            b.outstanding_net,
            l.rate_snapshot / NULLIF(sum(l.rate_snapshot) OVER (PARTITION BY d.sales_order_id), 0::numeric) AS net_weight,
            (l.rate_snapshot + COALESCE(l.vat_snapshot, 0::numeric)) / NULLIF(sum(l.rate_snapshot + COALESCE(l.vat_snapshot, 0::numeric)) OVER (PARTITION BY d.sales_order_id), 0::numeric) AS gross_weight,
            row_number() OVER (PARTITION BY d.sales_order_id ORDER BY l.id) AS rn,
            count(*) OVER (PARTITION BY d.sales_order_id) AS line_count
           FROM transport_customer_document_trips l
             JOIN transport_customer_documents d ON d.id = l.document_id
             JOIN service_balances b ON b.side = 'customer'::text AND b.order_id = d.sales_order_id AND b.billed_gross > 0.005::numeric
        ), customer_parts AS MATERIALIZED (
         SELECT customer_line_weights.id,
            customer_line_weights.trip_id,
            customer_line_weights.sales_order_id,
            customer_line_weights.side,
            customer_line_weights.order_id,
            customer_line_weights.company_id,
            customer_line_weights.business_unit_id,
            customer_line_weights.operating_location_id,
            customer_line_weights.party_id,
            customer_line_weights.order_no,
            customer_line_weights.order_date,
            customer_line_weights.original_gross,
            customer_line_weights.tax_percent,
            customer_line_weights.original_net,
            customer_line_weights.credited_net,
            customer_line_weights.credited_gross,
            customer_line_weights.paid_gross,
            customer_line_weights.last_payment_date,
            customer_line_weights.refunded_gross,
            customer_line_weights.billed_net,
            customer_line_weights.billed_gross,
            customer_line_weights.paid_net,
            customer_line_weights.outstanding_gross,
            customer_line_weights.credit_gross,
            customer_line_weights.outstanding_net,
            customer_line_weights.net_weight,
            customer_line_weights.gross_weight,
            customer_line_weights.rn,
            customer_line_weights.line_count,
            round(customer_line_weights.billed_net * customer_line_weights.net_weight, 2) AS n,
            round(customer_line_weights.billed_gross * customer_line_weights.gross_weight, 2) AS g,
            round(customer_line_weights.paid_net * customer_line_weights.net_weight, 2) AS pn,
            round((customer_line_weights.paid_gross - customer_line_weights.refunded_gross) * customer_line_weights.gross_weight, 2) AS pg,
            round(customer_line_weights.outstanding_gross * customer_line_weights.gross_weight, 2) AS og,
            round(customer_line_weights.outstanding_net * customer_line_weights.net_weight, 2) AS onet,
            round(customer_line_weights.credit_gross * customer_line_weights.gross_weight, 2) AS cg
           FROM customer_line_weights
        ), customer_exact AS MATERIALIZED (
         SELECT customer_parts.trip_id,
            customer_parts.sales_order_id,
                CASE
                    WHEN customer_parts.rn = customer_parts.line_count THEN customer_parts.billed_net - (sum(customer_parts.n) OVER (PARTITION BY customer_parts.sales_order_id) - customer_parts.n)
                    ELSE customer_parts.n
                END AS net,
                CASE
                    WHEN customer_parts.rn = customer_parts.line_count THEN customer_parts.billed_gross - (sum(customer_parts.g) OVER (PARTITION BY customer_parts.sales_order_id) - customer_parts.g)
                    ELSE customer_parts.g
                END AS gross,
                CASE
                    WHEN customer_parts.rn = customer_parts.line_count THEN customer_parts.paid_net - (sum(customer_parts.pn) OVER (PARTITION BY customer_parts.sales_order_id) - customer_parts.pn)
                    ELSE customer_parts.pn
                END AS paid_net,
                CASE
                    WHEN customer_parts.rn = customer_parts.line_count THEN customer_parts.paid_gross - customer_parts.refunded_gross - (sum(customer_parts.pg) OVER (PARTITION BY customer_parts.sales_order_id) - customer_parts.pg)
                    ELSE customer_parts.pg
                END AS paid_gross,
                CASE
                    WHEN customer_parts.rn = customer_parts.line_count THEN customer_parts.outstanding_gross - (sum(customer_parts.og) OVER (PARTITION BY customer_parts.sales_order_id) - customer_parts.og)
                    ELSE customer_parts.og
                END AS outstanding,
                CASE
                    WHEN customer_parts.rn = customer_parts.line_count THEN customer_parts.outstanding_net - (sum(customer_parts.onet) OVER (PARTITION BY customer_parts.sales_order_id) - customer_parts.onet)
                    ELSE customer_parts.onet
                END AS outstanding_net,
                CASE
                    WHEN customer_parts.rn = customer_parts.line_count THEN customer_parts.credit_gross - (sum(customer_parts.cg) OVER (PARTITION BY customer_parts.sales_order_id) - customer_parts.cg)
                    ELSE customer_parts.cg
                END AS credit
           FROM customer_parts
        ), customer_agg AS MATERIALIZED (
         SELECT customer_exact.trip_id,
            sum(customer_exact.net) AS net,
            sum(customer_exact.gross) AS gross,
            sum(customer_exact.paid_net) AS paid_net,
            sum(customer_exact.paid_gross) AS paid_gross,
            sum(customer_exact.outstanding) AS outstanding,
            sum(customer_exact.outstanding_net) AS outstanding_net,
            sum(customer_exact.credit) AS credit,
            count(DISTINCT customer_exact.sales_order_id) AS docs
           FROM customer_exact
          GROUP BY customer_exact.trip_id
        ), supplier_agg AS MATERIALIZED (
         SELECT transport_supplier_trip_document_balances.trip_id,
            sum(transport_supplier_trip_document_balances.billed_net) AS net,
            sum(transport_supplier_trip_document_balances.billed_gross) AS gross,
            sum(transport_supplier_trip_document_balances.paid_net) AS paid_net,
            sum(transport_supplier_trip_document_balances.paid_gross) AS paid_gross,
            sum(transport_supplier_trip_document_balances.outstanding_gross) AS outstanding,
            sum(transport_supplier_trip_document_balances.credit_gross) AS credit,
            max(transport_supplier_trip_document_balances.last_payment_date) AS last_date
           FROM ( WITH weighted AS (
                         SELECT l.id,
                            l.company_id,
                            l.business_unit_id,
                            l.trip_id,
                            l.rent_id,
                            d.purchase_order_id,
                            b.last_payment_date,
                            b.billed_net AS bn,
                            b.billed_gross AS bg,
                            LEAST(GREATEST(b.paid_gross - b.refunded_gross, 0::numeric), GREATEST(b.billed_gross, 0::numeric)) AS pg,
                            LEAST(GREATEST(b.paid_net, 0::numeric), b.billed_net) AS pn,
                            GREATEST(b.outstanding_gross, 0::numeric) AS og,
                            GREATEST(b.credit_gross, 0::numeric) AS cg,
                            l.amount_snapshot / NULLIF(sum(l.amount_snapshot) OVER (PARTITION BY d.purchase_order_id), 0::numeric) AS nw,
                            (l.amount_snapshot + COALESCE(l.vat_snapshot, 0::numeric)) / NULLIF(sum(l.amount_snapshot + COALESCE(l.vat_snapshot, 0::numeric)) OVER (PARTITION BY d.purchase_order_id), 0::numeric) AS gw,
                            row_number() OVER (PARTITION BY d.purchase_order_id ORDER BY l.id) AS rn,
                            count(*) OVER (PARTITION BY d.purchase_order_id) AS cnt
                           FROM transport_supplier_document_rents l
                             JOIN transport_supplier_documents d ON d.id = l.document_id
                             JOIN service_balances b ON b.side = 'supplier'::text AND b.order_id = d.purchase_order_id
                        ), parts AS (
                         SELECT weighted.id,
                            weighted.company_id,
                            weighted.business_unit_id,
                            weighted.trip_id,
                            weighted.rent_id,
                            weighted.purchase_order_id,
                            weighted.last_payment_date,
                            weighted.bn,
                            weighted.bg,
                            weighted.pg,
                            weighted.pn,
                            weighted.og,
                            weighted.cg,
                            weighted.nw,
                            weighted.gw,
                            weighted.rn,
                            weighted.cnt,
                            round(weighted.bn * weighted.nw, 2) AS nb,
                            round(weighted.bg * weighted.gw, 2) AS gb,
                            round(weighted.pg * weighted.gw, 2) AS gp,
                            round(weighted.pn * weighted.nw, 2) AS np,
                            round(weighted.og * weighted.gw, 2) AS op,
                            round(weighted.cg * weighted.gw, 2) AS cp
                           FROM weighted
                        )
                 SELECT parts.company_id,
                    parts.business_unit_id,
                    parts.trip_id,
                    parts.rent_id,
                    parts.purchase_order_id,
                        CASE
                            WHEN parts.rn = parts.cnt THEN parts.bn - (sum(parts.nb) OVER (PARTITION BY parts.purchase_order_id) - parts.nb)
                            ELSE parts.nb
                        END AS billed_net,
                        CASE
                            WHEN parts.rn = parts.cnt THEN parts.bg - (sum(parts.gb) OVER (PARTITION BY parts.purchase_order_id) - parts.gb)
                            ELSE parts.gb
                        END AS billed_gross,
                        CASE
                            WHEN parts.rn = parts.cnt THEN parts.pg - (sum(parts.gp) OVER (PARTITION BY parts.purchase_order_id) - parts.gp)
                            ELSE parts.gp
                        END AS paid_gross,
                        CASE
                            WHEN parts.rn = parts.cnt THEN parts.pn - (sum(parts.np) OVER (PARTITION BY parts.purchase_order_id) - parts.np)
                            ELSE parts.np
                        END AS paid_net,
                        CASE
                            WHEN parts.rn = parts.cnt THEN parts.og - (sum(parts.op) OVER (PARTITION BY parts.purchase_order_id) - parts.op)
                            ELSE parts.op
                        END AS outstanding_gross,
                        CASE
                            WHEN parts.rn = parts.cnt THEN parts.cg - (sum(parts.cp) OVER (PARTITION BY parts.purchase_order_id) - parts.cp)
                            ELSE parts.cp
                        END AS credit_gross,
                    parts.last_payment_date
                   FROM parts) transport_supplier_trip_document_balances
          GROUP BY transport_supplier_trip_document_balances.trip_id
        ), driver_accrual_agg AS MATERIALIZED (
         SELECT a.trip_id,
            sum(a.amount) AS accrued
           FROM transport_driver_accrual_attributions a
             JOIN employee_salary_accruals p ON p.id = a.accrual_id
             JOIN transport_active_journals j ON j.id = p.journal_entry_id
          GROUP BY a.trip_id
        ), driver_payment_agg AS MATERIALIZED (
         SELECT a.trip_id,
            sum(a.amount) AS paid
           FROM transport_driver_payment_attributions a
             JOIN employee_salary_payments p ON p.id = a.salary_payment_id
             JOIN transport_active_journals j ON j.id = p.journal_entry_id
          GROUP BY a.trip_id
        ), cost_agg AS MATERIALIZED (
         SELECT x.trip_id,
            sum(b.billed_net) AS net,
            sum(b.paid_net) FILTER (WHERE x.cost_kind = 'commission'::text) AS commission_paid,
            sum(b.outstanding_gross + b.credit_gross) AS required_outstanding
           FROM transport_service_cost_links x
             JOIN service_balances b ON b.side = 'supplier'::text AND b.order_id = x.purchase_order_id
          GROUP BY x.trip_id
        ), posted_rent_links AS MATERIALIZED (
         SELECT DISTINCT l.rent_id
           FROM transport_supplier_document_rents l
             JOIN transport_supplier_documents sd ON sd.id = l.document_id
             JOIN transport_active_journals j ON j.id = sd.journal_entry_id
          WHERE NOT l.is_adjustment
        ), rent_flags AS MATERIALIZED (
         SELECT r.trip_id,
            true AS structured_rents,
            bool_or(pl.rent_id IS NULL) AS unbilled_rent
           FROM transport_trip_supplier_rents r
             LEFT JOIN posted_rent_links pl ON pl.rent_id = r.id
          GROUP BY r.trip_id
        ), customer_link_flags AS MATERIALIZED (
         SELECT DISTINCT l.trip_id
           FROM transport_customer_document_trips l
             JOIN transport_customer_documents d ON d.id = l.document_id
             JOIN sales_orders o ON o.id = d.sales_order_id
             JOIN service_balances b ON b.side = 'customer'::text AND b.order_id = o.id
          WHERE o.status = 'posted'::text AND b.billed_gross > 0.005::numeric
        ), supplier_link_flags AS MATERIALIZED (
         SELECT DISTINCT l.trip_id
           FROM transport_supplier_document_rents l
             JOIN transport_supplier_documents d ON d.id = l.document_id
             JOIN purchase_orders o ON o.id = d.purchase_order_id
          WHERE NOT l.is_adjustment AND o.status = 'posted'::text
        ), evidence AS (
         SELECT t.id,
            t.company_id,
            t.business_unit_id,
            COALESCE(c.net, 0::numeric) AS customer_net,
            COALESCE(c.gross, 0::numeric) AS customer_gross,
            COALESCE(c.paid_net, 0::numeric) AS customer_received_net,
            COALESCE(c.paid_gross, 0::numeric) AS customer_received_gross,
            COALESCE(c.outstanding, 0::numeric) AS customer_outstanding_gross,
            COALESCE(c.outstanding_net, 0::numeric) AS customer_outstanding_net,
            COALESCE(c.credit, 0::numeric) AS customer_credit_gross,
            COALESCE(c.docs, 0::bigint) AS customer_documents,
            COALESCE(s.net, 0::numeric) AS supplier_net,
            COALESCE(s.gross, 0::numeric) AS supplier_gross,
            COALESCE(s.paid_net, 0::numeric) AS supplier_paid_net,
            COALESCE(s.paid_gross, 0::numeric) AS supplier_paid_gross,
            COALESCE(s.outstanding, 0::numeric) AS supplier_outstanding_gross,
            COALESCE(s.credit, 0::numeric) AS supplier_credit_gross,
            s.last_date AS supplier_payment_date,
            COALESCE(dr.accrued, 0::numeric) AS driver_accrued,
            COALESCE(dp.paid, 0::numeric) AS driver_paid,
            GREATEST(t.driver_pay - COALESCE(dp.paid, 0::numeric), 0::numeric) AS driver_outstanding,
            COALESCE(costs.net, 0::numeric) AS other_cost_net,
            COALESCE(costs.commission_paid, 0::numeric) AS commission_paid_net,
            COALESCE(costs.required_outstanding, 0::numeric) AS required_cost_outstanding,
            COALESCE(rf.structured_rents, false) AS structured_rents,
            COALESCE(rf.unbilled_rent, false) AS unbilled_rent,
            t.customer_rate AS original_customer_rate,
            t.owner_rent AS legacy_owner_rent,
            t.driver_pay AS agreed_driver_pay,
            t.trip_status AS operational_status,
            t.job_status,
            t.sales_order_id IS NOT NULL OR clf.trip_id IS NOT NULL AS customer_rate_locked,
            slf.trip_id IS NOT NULL AS supplier_rate_locked
           FROM transport_trips t
             LEFT JOIN rent_flags rf ON rf.trip_id = t.id
             LEFT JOIN customer_link_flags clf ON clf.trip_id = t.id
             LEFT JOIN supplier_link_flags slf ON slf.trip_id = t.id
             LEFT JOIN customer_agg c ON c.trip_id = t.id
             LEFT JOIN supplier_agg s ON s.trip_id = t.id
             LEFT JOIN driver_accrual_agg dr ON dr.trip_id = t.id
             LEFT JOIN driver_payment_agg dp ON dp.trip_id = t.id
             LEFT JOIN cost_agg costs ON costs.trip_id = t.id
        )
 SELECT id,
    company_id,
    business_unit_id,
    customer_net,
    customer_gross,
    customer_received_net,
    customer_received_gross,
    customer_outstanding_gross,
    customer_outstanding_net,
    customer_credit_gross,
    customer_documents,
    supplier_net,
    supplier_gross,
    supplier_paid_net,
    supplier_paid_gross,
    supplier_outstanding_gross,
    supplier_credit_gross,
    supplier_payment_date,
    driver_accrued,
    driver_paid,
    driver_outstanding,
    other_cost_net,
    commission_paid_net,
    required_cost_outstanding,
    structured_rents,
    unbilled_rent,
    original_customer_rate,
    legacy_owner_rent,
    agreed_driver_pay,
    operational_status,
    job_status,
    customer_rate_locked,
    supplier_rate_locked,
        CASE
            WHEN customer_documents = 0 THEN NULL::numeric
            ELSE customer_net - supplier_net - driver_accrued - other_cost_net
        END AS posted_profit,
        CASE
            WHEN operational_status = 'cancelled'::text THEN 'Cancelled'::text
            WHEN customer_documents > 0 AND (operational_status = ANY (ARRAY['completed'::text, 'ready_to_invoice'::text, 'invoiced'::text, 'paid'::text])) AND (job_status = ANY (ARRAY['completed'::text, 'done'::text])) AND customer_outstanding_gross <= 0.005 AND customer_credit_gross <= 0.005 AND supplier_outstanding_gross <= 0.005 AND supplier_credit_gross <= 0.005 AND driver_outstanding <= 0.005 AND driver_accrued >= (agreed_driver_pay - 0.005) AND NOT unbilled_rent AND (legacy_owner_rent <= 0::numeric OR structured_rents) AND required_cost_outstanding <= 0.005 THEN 'Closed'::text
            WHEN customer_rate_locked OR supplier_rate_locked OR driver_accrued > 0::numeric OR driver_paid > 0::numeric OR other_cost_net > 0::numeric THEN 'Under Settlement'::text
            WHEN operational_status = 'draft'::text THEN 'Draft'::text
            WHEN original_customer_rate > 0::numeric AND (legacy_owner_rent > 0::numeric OR structured_rents) THEN 'Complete'::text
            ELSE 'Not Complete'::text
        END AS financial_status
   FROM evidence;;