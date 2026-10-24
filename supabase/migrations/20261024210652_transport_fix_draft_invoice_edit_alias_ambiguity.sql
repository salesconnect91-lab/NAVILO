-- Resolve PL/pgSQL record variable `t` vs SQL table aliases used in this RPC.
-- Prefer SQL columns for ambiguous qualified references; procedural record reads remain intact.
CREATE OR REPLACE FUNCTION public.transport_edit_register_draft_invoice(
  p_side text,
  p_document_id uuid,
  p_line_ids uuid[],
  p_invoice_date date,
  p_invoice_no text,
  p_account_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict use_column
DECLARE
  c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id(); loc uuid:=public.current_operating_location_id();
  v_order uuid; v_company uuid; v_bu uuid; v_party uuid; v_invoice_no text:=nullif(btrim(p_invoice_no),'');
  v_old_no text; v_old_ids uuid[]; v_old_trip_ids uuid[]; v_trip_ids uuid[]; v_tax numeric; v_invoice_type text; v_rate numeric;
  v_count integer; v_expected integer; v_party_count integer; v_sale_type_count integer; v_customer uuid;
  v_supplier uuid; v_with_tax boolean; v_doc_kind text; v_net numeric:=0; v_vat numeric:=0; v_total numeric:=0;
  v_description text; v_old_descriptions jsonb:='{}'::jsonb; v_revenue_account uuid; v_cost_account uuid; t public.transport_trips%rowtype;
  x public.transport_trip_supplier_rents%rowtype; v_charge numeric; v_base numeric; v_line_vat numeric;
BEGIN
  IF auth.uid() IS NULL OR c IS NULL OR b IS NULL OR loc IS NULL THEN RAISE EXCEPTION 'Authenticated Transport workspace required'; END IF;
  IF p_invoice_date IS NULL OR v_invoice_no IS NULL OR length(v_invoice_no)>80 OR v_invoice_no ~ '[[:cntrl:]]' OR v_invoice_no LIKE '%-AUTO' THEN
    RAISE EXCEPTION 'Enter a valid invoice date and invoice number (maximum 80 characters)';
  END IF;
  IF p_line_ids IS NULL OR cardinality(p_line_ids)=0 OR cardinality(p_line_ids)>500 THEN RAISE EXCEPTION 'Select between 1 and 500 trips'; END IF;
  SELECT count(DISTINCT id) INTO v_expected FROM unnest(p_line_ids) id;
  IF v_expected<>cardinality(p_line_ids) THEN RAISE EXCEPTION 'Duplicate Trip selection is not allowed'; END IF;

  IF p_side='customer' THEN
    PERFORM public.transport_finance_assert('billing'); PERFORM public.assert_module_permission('sales','edit');
    SELECT d.sales_order_id,d.company_id,d.business_unit_id,d.customer_id,o.order_no,o.invoice_type,o.tax_percent,
      d.document_kind,coalesce((SELECT sl.revenue_account_id FROM public.sales_service_lines sl WHERE sl.order_id=o.id ORDER BY sl.created_at,sl.id LIMIT 1),p_account_id)
      INTO v_order,v_company,v_bu,v_party,v_old_no,v_invoice_type,v_tax,v_doc_kind,v_revenue_account
      FROM public.transport_customer_documents d JOIN public.sales_orders o ON o.id=d.sales_order_id
     WHERE d.id=p_document_id AND d.company_id=c AND d.business_unit_id=b AND d.operating_location_id=loc
       AND d.journal_entry_id IS NULL AND o.status='draft' AND o.document_kind='service' AND o.posted_at IS NULL FOR UPDATE OF d,o;
    IF NOT FOUND THEN RAISE EXCEPTION 'Only an unposted customer Register draft can be edited'; END IF;
    IF v_revenue_account IS NULL OR v_revenue_account IS DISTINCT FROM p_account_id OR NOT EXISTS(
      SELECT 1 FROM public.chart_of_accounts a WHERE a.id=p_account_id AND a.company_id=c AND a.type='revenue' AND a.is_active AND NOT a.is_group
    ) THEN RAISE EXCEPTION 'The saved active revenue account is required'; END IF;
    IF EXISTS(SELECT 1 FROM public.sales_orders o WHERE o.company_id=c AND lower(btrim(o.order_no))=lower(v_invoice_no) AND o.id<>v_order) THEN RAISE EXCEPTION 'Invoice number already exists in this company'; END IF;
    SELECT coalesce(array_agg(l.trip_id ORDER BY l.trip_id),'{}'::uuid[]) INTO v_old_ids FROM public.transport_customer_document_trips l WHERE l.document_id=p_document_id AND NOT l.is_adjustment;
    v_old_trip_ids:=v_old_ids;
    SELECT coalesce(jsonb_object_agg(sl.source_id::text,sl.description),'{}'::jsonb) INTO v_old_descriptions
      FROM public.sales_service_lines sl WHERE sl.order_id=v_order AND sl.source_module='transport' AND sl.source_id IS NOT NULL;
    SELECT count(*),count(DISTINCT t.customer_id),count(DISTINCT t.sale_type),(array_agg(t.customer_id ORDER BY t.id))[1]
      INTO v_count,v_party_count,v_sale_type_count,v_customer
      FROM public.transport_trips t WHERE t.id=ANY(p_line_ids) AND t.company_id=c AND t.business_unit_id=b AND t.operating_location_id=loc;
    IF v_count<>cardinality(p_line_ids) OR v_party_count<>1 OR v_customer IS DISTINCT FROM v_party OR v_sale_type_count<>1 THEN RAISE EXCEPTION 'Selected trips must belong to this customer and one billing mode'; END IF;
    IF EXISTS(SELECT 1 FROM public.transport_trips t WHERE t.id=ANY(p_line_ids) AND (t.customer_rate_state<>'finalized' OR t.customer_rate_snapshot IS NULL OR t.customer_rate_snapshot IS DISTINCT FROM t.customer_rate OR coalesce(t.customer_rate,0)<=0 OR t.status='cancelled' OR t.lifecycle_status='cancelled')) THEN RAISE EXCEPTION 'Every selected Trip needs an active finalized customer rate'; END IF;
    IF EXISTS(SELECT 1 FROM public.transport_customer_document_trips l WHERE l.trip_id=ANY(p_line_ids) AND NOT l.is_adjustment AND l.document_id<>p_document_id) OR EXISTS(SELECT 1 FROM public.transport_trips t WHERE t.id=ANY(p_line_ids) AND t.sales_order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM unnest(v_old_ids) x WHERE x=t.id)) THEN RAISE EXCEPTION 'A selected Trip is linked to another invoice'; END IF;
    v_with_tax:=v_invoice_type='Tax Invoice'; v_rate:=CASE WHEN v_with_tax THEN public.fixed_tax_rate_on(c,'sales',p_invoice_date) ELSE 0 END;
    IF v_rate IS NULL THEN RAISE EXCEPTION 'Effective fixed Sales VAT rate is required for this date'; END IF;
    SELECT coalesce(array_agg(DISTINCT t.id),'{}'::uuid[]) INTO v_trip_ids FROM public.transport_trips t WHERE t.id=ANY(p_line_ids);
    INSERT INTO public.transport_action_gate(transaction_id,trip_id,action) VALUES(txid_current(),p_document_id,'draft_invoice_edit') ON CONFLICT DO NOTHING;
    INSERT INTO public.transport_action_gate(transaction_id,trip_id,action) SELECT txid_current(),x,'draft_invoice_edit' FROM unnest(v_old_ids||v_trip_ids) x ON CONFLICT DO NOTHING;
    DELETE FROM public.sales_service_lines WHERE order_id=v_order;
    DELETE FROM public.sales_order_charges WHERE order_id=v_order;
    DELETE FROM public.transport_customer_document_trips WHERE document_id=p_document_id AND NOT is_adjustment;
    UPDATE public.sales_orders SET order_no=v_invoice_no,order_date=p_invoice_date,tax_percent=v_rate,total=0,updated_by=auth.uid(),updated_at=now() WHERE id=v_order;
    FOR t IN SELECT * FROM public.transport_trips WHERE id=ANY(v_trip_ids) ORDER BY trip_no,id LOOP
      v_base:=round(coalesce(t.customer_base_rate,t.customer_rate)+coalesce(t.customer_manual_adjustment,0),2);
      SELECT coalesce(sum(tc.amount),0) INTO v_charge FROM public.transport_trip_customer_charges tc JOIN public.charge_master cm ON cm.id=tc.charge_master_id WHERE tc.trip_id=t.id AND cm.company_id=c AND cm.is_active AND cm.applies_to IN ('sales','both');
      IF v_base<=0 OR round(v_base+v_charge,2) IS DISTINCT FROM round(t.customer_rate_snapshot,2) THEN RAISE EXCEPTION 'Customer base rate and charges do not reconcile for Trip %',t.trip_no; END IF;
      v_description:=v_old_descriptions->>t.id::text;
      INSERT INTO public.sales_service_lines(company_id,business_unit_id,order_id,description,amount,tax_percent,revenue_account_id,source_module,source_id,created_by)
      VALUES(c,b,v_order,coalesce(v_description,public.transport_trip_service_description(t.id)),v_base,v_rate,public.transport_trip_customer_income_account(t.id,p_account_id),'transport',t.id,auth.uid());
      SELECT round(v_base*v_rate/100,2)+coalesce(sum(CASE WHEN v_with_tax AND cm.tax_applicable THEN round(tc.amount*v_rate/100,2) ELSE 0 END),0)
        INTO v_line_vat FROM public.transport_trip_customer_charges tc JOIN public.charge_master cm ON cm.id=tc.charge_master_id WHERE tc.trip_id=t.id AND cm.company_id=c AND cm.is_active AND cm.applies_to IN ('sales','both');
      INSERT INTO public.transport_customer_document_trips(company_id,business_unit_id,operating_location_id,document_id,trip_id,rate_snapshot,vat_snapshot)
      VALUES(c,b,loc,p_document_id,t.id,t.customer_rate_snapshot,coalesce(v_line_vat,0));
      v_net:=v_net+t.customer_rate_snapshot; v_vat:=v_vat+coalesce(v_line_vat,0);
    END LOOP;
    INSERT INTO public.sales_order_charges(order_id,charge_key,charge_label,amount,tax_percent,account_id,charge_type,cost_amount,cost_account_id,company_id,business_unit_id,quantity,rate)
    SELECT v_order,cm.charge_key,cm.charge_name,round(sum(tc.amount),2),CASE WHEN v_with_tax AND cm.tax_applicable THEN v_rate ELSE 0 END,public.transport_trip_customer_income_account(tc.trip_id,p_account_id),'recovery',0,cm.cost_account_id,c,b,
      CASE WHEN cm.is_fixed THEN count(*)::numeric ELSE 1 END,CASE WHEN cm.is_fixed THEN cm.default_rate ELSE round(sum(tc.amount),2) END
    FROM public.transport_trip_customer_charges tc JOIN public.charge_master cm ON cm.id=tc.charge_master_id
    WHERE tc.trip_id=ANY(v_trip_ids) AND tc.company_id=c AND tc.business_unit_id=b AND cm.company_id=c AND cm.is_active AND cm.applies_to IN ('sales','both')
    GROUP BY cm.id,cm.charge_key,cm.charge_name,cm.cost_account_id,cm.tax_applicable,cm.is_fixed,cm.default_rate,
      public.transport_trip_customer_income_account(tc.trip_id,p_account_id);
    IF EXISTS(SELECT 1 FROM public.sales_order_charges WHERE order_id=v_order AND account_id IS NULL) THEN RAISE EXCEPTION 'Every customer charge requires a revenue account mapping'; END IF;
    SELECT v_net+coalesce(sum(amount),0),v_vat+coalesce(sum(round(amount*tax_percent/100,2)),0) INTO v_net,v_vat FROM public.sales_order_charges WHERE order_id=v_order;
    v_total:=round(v_net+v_vat,2);
    UPDATE public.sales_orders SET total=v_total,outstanding_amount=v_total,paid_amount=0,payment_status='unpaid' WHERE id=v_order;
    UPDATE public.transport_customer_document_trips SET vat_snapshot=round(vat_snapshot+(v_vat-(SELECT coalesce(sum(vat_snapshot),0) FROM public.transport_customer_document_trips WHERE document_id=p_document_id)),2)
      WHERE id=(SELECT id FROM public.transport_customer_document_trips WHERE document_id=p_document_id ORDER BY id DESC LIMIT 1)
        AND abs(v_vat-(SELECT coalesce(sum(vat_snapshot),0) FROM public.transport_customer_document_trips WHERE document_id=p_document_id))>=0.005;
  ELSIF p_side='supplier' THEN
    PERFORM public.transport_finance_assert('rent'); PERFORM public.assert_module_permission('purchase','edit');
    SELECT d.purchase_order_id,d.company_id,d.business_unit_id,d.supplier_id,o.order_no,o.invoice_type,o.tax_percent,
      coalesce((SELECT sl.cost_account_id FROM public.purchase_service_lines sl WHERE sl.order_id=o.id ORDER BY sl.created_at,sl.id LIMIT 1),p_account_id)
      INTO v_order,v_company,v_bu,v_party,v_old_no,v_invoice_type,v_tax,v_cost_account
      FROM public.transport_supplier_documents d JOIN public.purchase_orders o ON o.id=d.purchase_order_id
     WHERE d.id=p_document_id AND d.company_id=c AND d.business_unit_id=b AND d.operating_location_id=loc
       AND d.journal_entry_id IS NULL AND o.status='draft' AND o.document_kind='service' AND o.posted_at IS NULL FOR UPDATE OF d,o;
    IF NOT FOUND THEN RAISE EXCEPTION 'Only an unposted supplier Register draft can be edited'; END IF;
    IF v_cost_account IS NULL OR v_cost_account IS DISTINCT FROM p_account_id OR NOT EXISTS(SELECT 1 FROM public.chart_of_accounts a WHERE a.id=p_account_id AND a.company_id=c AND a.type='expense' AND a.is_active AND NOT a.is_group) THEN RAISE EXCEPTION 'The saved active expense account is required'; END IF;
    IF EXISTS(SELECT 1 FROM public.purchase_orders o WHERE o.company_id=c AND lower(btrim(o.order_no))=lower(v_invoice_no) AND o.id<>v_order) THEN RAISE EXCEPTION 'Invoice number already exists in this company'; END IF;
    SELECT coalesce(array_agg(l.rent_id ORDER BY l.rent_id),'{}'::uuid[]) INTO v_old_ids FROM public.transport_supplier_document_rents l WHERE l.document_id=p_document_id AND NOT l.is_adjustment;
    SELECT coalesce(array_agg(DISTINCT l.trip_id ORDER BY l.trip_id),'{}'::uuid[]) INTO v_old_trip_ids
      FROM public.transport_supplier_document_rents l WHERE l.document_id=p_document_id AND NOT l.is_adjustment;
    SELECT coalesce(jsonb_object_agg(sl.source_id::text,sl.description),'{}'::jsonb) INTO v_old_descriptions
      FROM public.purchase_service_lines sl WHERE sl.order_id=v_order AND sl.source_module='transport' AND sl.source_id IS NOT NULL;
    SELECT count(*),count(DISTINCT r.supplier_id),(array_agg(r.supplier_id ORDER BY r.id))[1] INTO v_count,v_party_count,v_supplier FROM public.transport_trip_supplier_rents r WHERE r.id=ANY(p_line_ids) AND r.company_id=c AND r.business_unit_id=b AND r.operating_location_id=loc;
    IF v_count<>cardinality(p_line_ids) OR v_party_count<>1 OR v_supplier IS DISTINCT FROM v_party THEN RAISE EXCEPTION 'Selected rents must belong to this supplier'; END IF;
    IF EXISTS(SELECT 1 FROM public.transport_trip_supplier_rents r WHERE r.id=ANY(p_line_ids) AND (r.state<>'finalized' OR r.finalized_amount_snapshot IS NULL OR r.finalized_amount_snapshot IS DISTINCT FROM r.amount OR r.amount<=0)) THEN RAISE EXCEPTION 'Every selected rent must have a consistent finalized amount'; END IF;
    IF EXISTS(SELECT 1 FROM public.transport_supplier_document_rents l WHERE l.rent_id=ANY(p_line_ids) AND NOT l.is_adjustment AND l.document_id<>p_document_id) THEN RAISE EXCEPTION 'A selected rent is linked to another invoice'; END IF;
    v_with_tax:=v_invoice_type='Tax Invoice'; v_rate:=CASE WHEN v_with_tax THEN public.fixed_tax_rate_on(c,'purchase',p_invoice_date) ELSE 0 END;
    IF v_rate IS NULL THEN RAISE EXCEPTION 'Effective fixed Purchase VAT rate is required for this date'; END IF;
    SELECT coalesce(array_agg(DISTINCT r.trip_id),'{}'::uuid[]) INTO v_trip_ids FROM public.transport_trip_supplier_rents r WHERE r.id=ANY(p_line_ids);
    INSERT INTO public.transport_action_gate(transaction_id,trip_id,action) VALUES(txid_current(),p_document_id,'draft_invoice_edit') ON CONFLICT DO NOTHING;
    INSERT INTO public.transport_action_gate(transaction_id,trip_id,action) SELECT txid_current(),t,'draft_invoice_edit' FROM (SELECT DISTINCT r.trip_id t FROM public.transport_supplier_document_rents l JOIN public.transport_trip_supplier_rents r ON r.id=l.rent_id WHERE l.document_id=p_document_id AND NOT l.is_adjustment UNION SELECT DISTINCT r.trip_id FROM public.transport_trip_supplier_rents r WHERE r.id=ANY(p_line_ids)) x ON CONFLICT DO NOTHING;
    DELETE FROM public.purchase_service_lines WHERE order_id=v_order;
    DELETE FROM public.purchase_order_charges WHERE order_id=v_order;
    DELETE FROM public.transport_supplier_document_rents WHERE document_id=p_document_id AND NOT is_adjustment;
    UPDATE public.purchase_orders SET order_no=v_invoice_no,order_date=p_invoice_date,supplier_invoice_date=p_invoice_date,tax_percent=v_rate,total=0,updated_by=auth.uid(),updated_at=now() WHERE id=v_order;
    FOR x IN SELECT * FROM public.transport_trip_supplier_rents WHERE id=ANY(p_line_ids) ORDER BY created_at,id LOOP
      t:=public.transport_financial_trip(x.trip_id); v_base:=coalesce(x.finalized_base_amount_snapshot,x.base_amount,x.finalized_amount_snapshot);
      SELECT coalesce(sum(sc.amount),0) INTO v_charge FROM public.transport_trip_supplier_charges sc JOIN public.charge_master cm ON cm.id=sc.charge_master_id WHERE sc.rent_id=x.id AND cm.company_id=c AND cm.is_active AND cm.applies_to IN ('purchase','both');
      IF v_base<=0 OR round(v_base+v_charge,2) IS DISTINCT FROM round(x.finalized_amount_snapshot,2) THEN RAISE EXCEPTION 'Supplier base rent and charges do not reconcile for Trip %',t.trip_no; END IF;
      v_description:=v_old_descriptions->>t.id::text;
      INSERT INTO public.purchase_service_lines(company_id,business_unit_id,order_id,description,amount,tax_percent,cost_account_id,source_module,source_id,created_by)
      VALUES(c,b,v_order,coalesce(v_description,public.transport_trip_service_description(t.id)||' · Supplier rent'),v_base,v_rate,p_account_id,'transport',t.id,auth.uid());
      SELECT round(v_base*v_rate/100,2)+coalesce(sum(CASE WHEN v_with_tax AND cm.tax_applicable THEN round(sc.amount*v_rate/100,2) ELSE 0 END),0)
        INTO v_line_vat FROM public.transport_trip_supplier_charges sc JOIN public.charge_master cm ON cm.id=sc.charge_master_id WHERE sc.rent_id=x.id AND cm.company_id=c AND cm.is_active AND cm.applies_to IN ('purchase','both');
      INSERT INTO public.transport_supplier_document_rents(company_id,business_unit_id,operating_location_id,document_id,rent_id,trip_id,amount_snapshot,vat_snapshot)
      VALUES(c,b,loc,p_document_id,x.id,x.trip_id,x.finalized_amount_snapshot,coalesce(v_line_vat,0));
      v_net:=v_net+x.finalized_amount_snapshot; v_vat:=v_vat+coalesce(v_line_vat,0);
    END LOOP;
    INSERT INTO public.purchase_order_charges(user_id,company_id,business_unit_id,order_id,charge_key,charge_label,amount,tax_percent,treatment,cost_account_id,quantity,rate)
    SELECT public.legacy_data_user_id(),c,b,v_order,cm.charge_key,cm.charge_name,round(sum(sc.amount),2),CASE WHEN v_with_tax AND cm.tax_applicable THEN v_rate ELSE 0 END,
      coalesce(cm.purchase_treatment,'expense'),cm.cost_account_id,CASE WHEN cm.is_fixed THEN count(*)::numeric ELSE 1 END,CASE WHEN cm.is_fixed THEN cm.default_rate ELSE round(sum(sc.amount),2) END
    FROM public.transport_trip_supplier_charges sc JOIN public.charge_master cm ON cm.id=sc.charge_master_id
    WHERE sc.rent_id=ANY(p_line_ids) AND sc.company_id=c AND sc.business_unit_id=b AND cm.company_id=c AND cm.is_active AND cm.applies_to IN ('purchase','both')
    GROUP BY cm.id,cm.charge_key,cm.charge_name,cm.tax_applicable,cm.purchase_treatment,cm.cost_account_id,cm.is_fixed,cm.default_rate;
    IF EXISTS(SELECT 1 FROM public.purchase_order_charges WHERE order_id=v_order AND cost_account_id IS NULL) THEN RAISE EXCEPTION 'Every supplier charge requires a cost account mapping'; END IF;
    SELECT v_net+coalesce(sum(amount),0),v_vat+coalesce(sum(round(amount*tax_percent/100,2)),0) INTO v_net,v_vat FROM public.purchase_order_charges WHERE order_id=v_order;
    v_total:=round(v_net+v_vat,2);
    UPDATE public.purchase_orders SET total=v_total,outstanding_amount=v_total,paid_amount=0,payment_status='unpaid' WHERE id=v_order;
    UPDATE public.transport_supplier_document_rents SET vat_snapshot=round(vat_snapshot+(v_vat-(SELECT coalesce(sum(vat_snapshot),0) FROM public.transport_supplier_document_rents WHERE document_id=p_document_id)),2)
      WHERE id=(SELECT id FROM public.transport_supplier_document_rents WHERE document_id=p_document_id ORDER BY id DESC LIMIT 1)
        AND abs(v_vat-(SELECT coalesce(sum(vat_snapshot),0) FROM public.transport_supplier_document_rents WHERE document_id=p_document_id))>=0.005;
  ELSE
    RAISE EXCEPTION 'Invoice side must be customer or supplier';
  END IF;

  PERFORM public.transport_refresh_document_balance(p_side,v_order);
  IF p_side='customer' THEN
    PERFORM public.transport_financial_audit(a.trip_id,'customer_bill_draft_edited',jsonb_build_object('document_id',p_document_id,'order_id',v_order,'old_invoice_no',v_old_no,'invoice_no',v_invoice_no,'old_line_ids',v_old_ids,'new_line_ids',p_line_ids,'net',round(v_net,2),'vat',round(v_vat,2),'total',v_total))
      FROM (SELECT DISTINCT unnest(coalesce(v_old_trip_ids,'{}'::uuid[])||coalesce(v_trip_ids,'{}'::uuid[])) trip_id) a;
  ELSE
    PERFORM public.transport_financial_audit(a.trip_id,'supplier_bill_draft_edited',jsonb_build_object('document_id',p_document_id,'order_id',v_order,'old_invoice_no',v_old_no,'invoice_no',v_invoice_no,'old_line_ids',v_old_ids,'new_line_ids',p_line_ids,'net',round(v_net,2),'vat',round(v_vat,2),'total',v_total))
      FROM (SELECT DISTINCT unnest(coalesce(v_old_trip_ids,'{}'::uuid[])||coalesce(v_trip_ids,'{}'::uuid[])) trip_id) a;
  END IF;
  DELETE FROM public.transport_action_gate WHERE transaction_id=txid_current() AND action='draft_invoice_edit';
  RETURN jsonb_build_object('status','updated','document_id',p_document_id,'order_id',v_order,'invoice_no',v_invoice_no,'trip_count',cardinality(p_line_ids),'net',round(v_net,2),'vat',round(v_vat,2),'total',v_total);
END
$$;

REVOKE ALL ON FUNCTION public.transport_edit_register_draft_invoice(text,uuid,uuid[],date,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_edit_register_draft_invoice(text,uuid,uuid[],date,text,uuid) TO authenticated;
