-- Keep every new manual invoice draft until the explicit Post action.
-- Add a full Transport service invoice reversal that preserves the posted source.
BEGIN;

DO $draft_only$
DECLARE
  v_signature text;
  v_definition text;
  v_guard text := E' IF p_post IS DISTINCT FROM false THEN\n   RAISE EXCEPTION ''Invoice creation and import must remain Draft until explicit posting.'';\n END IF;\n';
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.transport_normal_invoice_create(text,uuid,date,jsonb,uuid,text,text,boolean)',
    'public.transport_normal_invoice_import(text,jsonb,boolean)',
    'public.general_expense_bill_create(uuid,date,text,uuid,jsonb,boolean,boolean,text)',
    'public.general_expense_bill_import(jsonb,boolean)'
  ] LOOP
    SELECT pg_get_functiondef(v_signature::regprocedure) INTO v_definition;
    IF v_definition IS NULL THEN RAISE EXCEPTION 'Required invoice function missing: %',v_signature; END IF;
    IF position('Invoice creation and import must remain Draft until explicit posting.' IN v_definition)=0 THEN
      IF position(E'\nBEGIN\n' IN v_definition)=0 THEN
        RAISE EXCEPTION 'Invoice function body changed; review draft-only patch: %',v_signature;
      END IF;
      v_definition:=replace(v_definition,E'\nBEGIN\n',E'\nBEGIN\n'||v_guard);
      EXECUTE v_definition;
    END IF;
  END LOOP;
END
$draft_only$;

CREATE OR REPLACE FUNCTION public.transport_reverse_service_invoice(
  p_side text,p_order_id uuid,p_note_date date,p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $service_reverse$
DECLARE
  v_company uuid:=public.current_company_id();
  v_bu uuid:=public.current_business_unit_id();
  v_loc uuid:=public.current_operating_location_id();
  v_user uuid:=public.legacy_data_user_id();
  v_order record;
  v_source_id uuid;
  v_party_name text;
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
    p_side,CASE WHEN p_side='customer' THEN v_order.customer_id ELSE v_order.supplier_id END,
    v_party_name,p_note_date,btrim(p_reason),'draft',v_net,v_tax,v_total,0
  );
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
  RETURN jsonb_build_object('success',true,'side',p_side,'order_id',p_order_id,
    'note_id',v_note,'note_no',v_no,'journal_entry_id',v_journal,'source_journal_id',v_source_id,
    'net',v_net,'vat',v_tax,'total',v_total,'post_result',v_post);
END
$service_reverse$;

REVOKE ALL ON FUNCTION public.transport_reverse_service_invoice(text,uuid,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_reverse_service_invoice(text,uuid,date,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
