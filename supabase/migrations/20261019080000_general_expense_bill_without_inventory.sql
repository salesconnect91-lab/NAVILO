-- Non-inventory supplier Expense Bill for every active NAVILO business unit.
-- Reuses canonical purchase service posting (Expense / Input VAT / AP / GL).
-- Does not alter Transport Trip Service Invoice or stock accounting.
BEGIN;
CREATE OR REPLACE FUNCTION public.general_expense_bill_create(
  p_supplier uuid,p_date date,p_supplier_invoice_no text,p_account uuid,
  p_lines jsonb,p_vat boolean DEFAULT false,p_post boolean DEFAULT false,
  p_reference text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public,pg_temp AS $fn$
DECLARE
 c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();
 loc uuid:=public.current_operating_location_id();u uuid:=public.legacy_data_user_id();
 tax numeric:=0;expected numeric; mode text;total numeric:=0;v numeric;line jsonb;
 doc uuid;number text;invoice_class text;res jsonb;
BEGIN
 IF auth.uid() IS NULL OR c IS NULL OR b IS NULL OR loc IS NULL OR u IS NULL
    OR p_supplier IS NULL OR p_date IS NULL OR p_account IS NULL
    OR nullif(btrim(p_supplier_invoice_no),'') IS NULL OR length(btrim(p_supplier_invoice_no))>80
    OR p_vat IS NULL OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100
    OR octet_length(p_lines::text)>150000
 THEN RAISE EXCEPTION 'Company, Supplier, original expense invoice, date and 1–100 lines required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.business_units WHERE id=b AND company_id=c AND is_active)
  OR NOT EXISTS(SELECT 1 FROM public.operating_locations WHERE id=loc AND company_id=c AND business_unit_id=b AND is_active)
 THEN RAISE EXCEPTION 'Active company business unit and location required'; END IF;
 PERFORM public.assert_module_permission('purchase','create');
 IF p_post THEN PERFORM public.assert_module_permission('purchase','post');END IF;
 IF NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=p_supplier AND company_id=c AND is_active
   AND (account_id IS NULL OR account_id=public.fx_mapping_account(u,c,'accounts_payable','liability')))
 THEN RAISE EXCEPTION 'Active Supplier must match the company AP account';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.chart_of_accounts WHERE id=p_account AND company_id=c AND is_active
     AND NOT is_group AND type='expense')
 THEN RAISE EXCEPTION 'Active company Expense GL account required'; END IF;
 IF EXISTS(SELECT 1 FROM public.purchase_orders WHERE company_id=c AND supplier_id=p_supplier
    AND btrim(coalesce(supplier_invoice_no,''))=btrim(p_supplier_invoice_no) AND status<>'cancelled')
 THEN RAISE EXCEPTION 'This supplier invoice number is already recorded';END IF;
 IF p_vat THEN
   tax:=public.fixed_tax_rate_on(c,'purchase',p_date);
   IF tax IS NULL OR tax<=0 THEN RAISE EXCEPTION 'No effective Purchase VAT rate exists for invoice date';END IF;
 END IF;
 -- Respect existing Transport supplier Cash/Credit VAT rules.
 IF public.transport_customer_billing_scope(c,b) THEN
   mode:=public.transport_party_billing_mode('supplier',c,b,p_supplier);
   expected:=public.transport_billing_rate(c,'supplier',p_date,mode);
   IF tax IS DISTINCT FROM expected THEN
     RAISE EXCEPTION 'Selected VAT differs from Supplier Master Cash/Credit billing rule. Update the billing classification before creating this invoice';
   END IF;
 END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  IF nullif(btrim(line->>'description'),'') IS NULL OR length(line->>'description')>1000
      OR coalesce(line->>'amount','') !~ '^[0-9]{1,12}([.][0-9]{1,2})?$'
  THEN RAISE EXCEPTION 'Every expense line needs description and positive amount with two decimals';END IF;
  v:=(line->>'amount')::numeric;
  IF v<=0 THEN RAISE EXCEPTION 'Expense amounts must be positive';END IF;
  total:=total+v;
 END LOOP;
 IF total>999999999999 THEN RAISE EXCEPTION 'Expense invoice total exceeds limit'; END IF;
 invoice_class:=CASE WHEN tax>0 THEN 'Tax Invoice' ELSE 'Purchase Invoice' END;
 number:='EXP-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16));
 INSERT INTO public.purchase_orders(
 user_id,company_id,business_unit_id,operating_location_id,order_no,supplier_id,order_date,
 status,invoice_type,tax_percent,document_kind,supplier_invoice_no,supplier_invoice_date,
 total,outstanding_amount,payment_status)
 VALUES(u,c,b,loc,number,p_supplier,p_date,'draft',invoice_class,tax,'service',
 btrim(p_supplier_invoice_no),p_date,round(total*(1+tax/100),2),round(total*(1+tax/100),2),'unpaid')
 RETURNING id INTO doc;
 FOR line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
   INSERT INTO public.purchase_service_lines(
     company_id,business_unit_id,order_id,description,amount,tax_percent,
     cost_account_id,source_module,source_id,created_by)
   VALUES(c,b,doc,btrim(line->>'description'),(line->>'amount')::numeric,tax,
     p_account,'general_expense_bill',NULL,auth.uid());
 END LOOP;
 IF p_post THEN res:=public.post_purchase_invoice(doc);END IF;
 RETURN jsonb_build_object('document_id',doc,'invoice_no',number,'supplier_invoice_no',btrim(p_supplier_invoice_no),
   'net',total,'vat',round(total*tax/100,2),'gross',round(total*(1+tax/100),2),
   'status',CASE WHEN p_post THEN 'posted' ELSE 'draft' END,
   'journal_entry_id',res->>'journal_entry_id');
END $fn$;
REVOKE ALL ON FUNCTION public.general_expense_bill_create(uuid,date,text,uuid,jsonb,boolean,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.general_expense_bill_create(uuid,date,text,uuid,jsonb,boolean,boolean,text) TO authenticated;
COMMIT;