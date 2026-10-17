-- Standalone description-only Sales/Purchase documents for ALL Transport companies.
-- Reuses the canonical service posting path. No Trip is created or linked.
-- No existing data is changed by this forward-only migration.
CREATE OR REPLACE FUNCTION public.transport_normal_invoice_create(
 p_side text,p_party uuid,p_date date,p_lines jsonb,p_account uuid,
 p_invoice_no text DEFAULT NULL,p_reference text DEFAULT NULL,p_post boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
 c uuid:=public.current_company_id();
 b uuid:=public.current_business_unit_id();
 loc uuid:=public.current_operating_location_id();
 u uuid:=public.legacy_data_user_id();
 base text; mode text; tax numeric; doc uuid; number text; total numeric:=0;
 line jsonb; amount numeric; description text; line_count int:=0; outcome jsonb;
 side_module text; kind text;
BEGIN
 IF auth.uid() IS NULL OR c IS NULL OR b IS NULL OR loc IS NULL OR p_side NOT IN ('customer','supplier')
 OR p_party IS NULL OR p_date IS NULL OR p_account IS NULL OR jsonb_typeof(p_lines)<>'array'
 OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 50 OR octet_length(p_lines::text)>100000
 THEN RAISE EXCEPTION 'Valid standalone Sales/Purchase invoice and active Transport workspace required';END IF;
 IF NOT EXISTS (SELECT 1 FROM public.business_units WHERE id=b AND company_id=c AND unit_type='transport' AND is_active)
 THEN RAISE EXCEPTION 'Normal service invoices are available only in an active Transport business unit';END IF;
 IF NOT EXISTS (SELECT 1 FROM public.operating_locations WHERE id=loc AND company_id=c AND business_unit_id=b AND is_active)
 THEN RAISE EXCEPTION 'Active Transport operating location required'; END IF;
 side_module:=CASE WHEN p_side='customer' THEN 'sales' ELSE 'purchase' END;
 PERFORM public.assert_module_permission(side_module,'create');
 IF p_post THEN PERFORM public.assert_module_permission(side_module,'post'); END IF;
 IF p_side='customer' THEN
   IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id=p_party AND company_id=c AND is_active)
   THEN RAISE EXCEPTION 'Active Customer Master in current company required'; END IF;
 ELSE
   IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id=p_party AND company_id=c AND is_active)
   THEN RAISE EXCEPTION 'Active Supplier Master in current company required'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.chart_of_accounts a WHERE a.id=p_account AND a.company_id=c
   AND a.is_active AND NOT a.is_group
   AND a.type=CASE WHEN p_side='customer' THEN 'revenue' ELSE 'expense' END)
 THEN RAISE EXCEPTION 'Active same-company service Revenue/Expense Account required'; END IF;
 mode:=public.transport_party_billing_mode(p_side,c,b,p_party);
 IF p_side='customer' AND mode='Credit' AND
   (nullif(btrim(p_invoice_no),'') IS NULL OR upper(btrim(p_invoice_no)) LIKE 'H-S-%'
    OR upper(btrim(p_invoice_no)) IN ('YES','CLEARED','NO INVOICE','BAD DEBTS','PENDING'))
 THEN RAISE EXCEPTION 'Credit Sales requires genuine original invoice number; no H-S or remark reference';END IF;
 tax:=public.transport_billing_rate(c,p_side,p_date,mode);
 IF tax IS NULL THEN RAISE EXCEPTION 'Effective VAT configuration required';END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
   description:=nullif(btrim(line->>'description'),'');
   IF description IS NULL OR length(description)>1000 OR
      coalesce(line->>'amount','') !~ '^([0-9]{1,12})([.][0-9]{1,2})?$'
   THEN RAISE EXCEPTION 'Invoice lines require a description and valid positive SAR amount';END IF;
   amount:=(line->>'amount')::numeric;
   IF amount<=0 THEN RAISE EXCEPTION 'Invoice amount must be positive';END IF;
   total:=total+amount;line_count:=line_count+1;
 END LOOP;
 IF total>999999999999 THEN RAISE EXCEPTION 'Invoice total exceeds allowed range';END IF;
 number:=public.transport_choose_invoice_number(p_side,p_invoice_no);
 SELECT base_currency_code INTO base FROM public.companies WHERE id=c;
 IF p_side='customer' THEN
   INSERT INTO public.sales_orders(user_id,company_id,business_unit_id,operating_location_id,
     order_no,customer_id,order_date,status,invoice_type,tax_percent,currency_code,
     exchange_rate,document_kind,payment_mode,reference_no)
   VALUES(u,c,b,loc,number,p_party,p_date,'draft',
     CASE WHEN mode='Credit' THEN 'Tax Invoice' ELSE 'Sale Invoice' END,tax,base,1,'service',mode,
     nullif(btrim(p_reference),''))
   RETURNING id INTO doc;
   FOR line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO public.sales_service_lines(company_id,business_unit_id,order_id,description,amount,tax_percent,revenue_account_id,source_module,created_by)
    VALUES(c,b,doc,btrim(line->>'description'),(line->>'amount')::numeric,tax,p_account,'transport_normal',auth.uid());
   END LOOP;
   IF p_post THEN outcome:=public.post_sales_invoice(doc); END IF;
 ELSE
   INSERT INTO public.purchase_orders(user_id,company_id,business_unit_id,operating_location_id,
      order_no,supplier_id,order_date,status,invoice_type,tax_percent,currency_code,
      exchange_rate,document_kind,supplier_invoice_no,supplier_invoice_date,reference_no)
   VALUES(u,c,b,loc,number,p_party,p_date,'draft',
      CASE WHEN mode='Credit' THEN 'Tax Invoice' ELSE 'Purchase Invoice' END,
      tax,base,1,'service',coalesce(nullif(btrim(p_reference),''),number),p_date,
      nullif(btrim(p_reference),''))
   RETURNING id INTO doc;
   FOR line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO public.purchase_service_lines(company_id,business_unit_id,order_id,description,amount,tax_percent,cost_account_id,source_module,created_by)
    VALUES(c,b,doc,btrim(line->>'description'),(line->>'amount')::numeric,tax,p_account,'transport_normal',auth.uid());
   END LOOP;
   IF p_post THEN outcome:=public.post_purchase_invoice(doc); END IF;
 END IF;
 RETURN jsonb_build_object('side',p_side,'document_id',doc,'invoice_no',number,'lines',line_count,
   'net',total,'vat',round(total*tax/100,2),'gross',round(total*(1+tax/100),2),
   'status',CASE WHEN p_post THEN 'posted' ELSE 'draft' END,
   'journal_entry_id',outcome->>'journal_entry_id');
END
$function$;
REVOKE ALL ON FUNCTION public.transport_normal_invoice_create(text,uuid,date,jsonb,uuid,text,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_normal_invoice_create(text,uuid,date,jsonb,uuid,text,text,boolean) TO authenticated;
-- Grouped all-or-nothing Excel/CSV import. Every batch source key denotes ONE invoice.
CREATE OR REPLACE FUNCTION public.transport_normal_invoice_import(p_side text,p_rows jsonb,p_post boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
 grp record; row_data jsonb; key_text text; results jsonb:='[]'::jsonb; lines jsonb;
 v_count integer; v_groups integer; v_party uuid; v_account uuid;
 v_date date; v_invoice text; v_reference text;
BEGIN
 IF auth.uid() IS NULL OR p_side NOT IN('customer','supplier')
 OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 200
 OR octet_length(p_rows::text)>300000 THEN RAISE EXCEPTION '1–200 valid invoice import rows required';END IF;
 FOR row_data IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF nullif(btrim(row_data->>'batch_ref'),'') IS NULL
   OR length(row_data->>'batch_ref')>80
   OR coalesce(row_data->>'party_id','') !~ '^[a-fA-F0-9-]{36}$'
   OR coalesce(row_data->>'account_id','') !~ '^[a-fA-F0-9-]{36}$'
   OR coalesce(row_data->>'invoice_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  THEN RAISE EXCEPTION 'Import Batch Reference, Master ID, Account ID and valid invoice date required';END IF;
 END LOOP;
 SELECT count(DISTINCT btrim(value->>'batch_ref')) INTO v_groups FROM jsonb_array_elements(p_rows);
 IF v_groups>50 THEN RAISE EXCEPTION 'Maximum 50 invoices per import batch';END IF;
 FOR grp IN SELECT btrim(value->>'batch_ref') batch_ref FROM jsonb_array_elements(p_rows) GROUP BY 1 ORDER BY 1 LOOP
  SELECT count(*),(array_agg((value->>'party_id')::uuid))[1],(array_agg((value->>'account_id')::uuid))[1],
    (array_agg((value->>'invoice_date')::date))[1],min(btrim(coalesce(value->>'invoice_no',''))),
    min(btrim(coalesce(value->>'reference','')))
  INTO v_count,v_party,v_account,v_date,v_invoice,v_reference
  FROM jsonb_array_elements(p_rows) WHERE btrim(value->>'batch_ref')=grp.batch_ref;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) z WHERE btrim(z->>'batch_ref')=grp.batch_ref
       AND (z->>'party_id')::uuid IS DISTINCT FROM v_party
           OR btrim(z->>'batch_ref')=grp.batch_ref AND
           ((z->>'account_id')::uuid IS DISTINCT FROM v_account OR (z->>'invoice_date')::date IS DISTINCT FROM v_date
           OR btrim(coalesce(z->>'invoice_no','')) IS DISTINCT FROM v_invoice
           OR btrim(coalesce(z->>'reference','')) IS DISTINCT FROM v_reference))
  THEN RAISE EXCEPTION 'Invoice % contains mismatched Customer/Supplier, date, number, reference or account',grp.batch_ref;END IF;
  SELECT jsonb_agg(jsonb_build_object('description',z->>'description','amount',z->>'amount')) INTO lines
   FROM jsonb_array_elements(p_rows) z WHERE btrim(z->>'batch_ref')=grp.batch_ref;
  results:=results||jsonb_build_array(public.transport_normal_invoice_create(p_side,v_party,v_date,lines,
     v_account,nullif(v_invoice,''),nullif(v_reference,''),p_post));
 END LOOP;
 RETURN jsonb_build_object('invoices',v_groups,'lines',jsonb_array_length(p_rows),'documents',results);
END
$function$;
REVOKE ALL ON FUNCTION public.transport_normal_invoice_import(text,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_normal_invoice_import(text,jsonb,boolean) TO authenticated;
