-- NAVILO: one-time Vehicle Master to Income COA linking for Transport normal Sales.
-- Non-trip Sales from /sales and /sales/new?type=normal use the same server posting flow.
-- No historical journals, posted invoices or old GL accounts are updated.
BEGIN;
ALTER TABLE public.transport_vehicles
  ADD COLUMN IF NOT EXISTS revenue_account_id uuid REFERENCES public.chart_of_accounts(id);

CREATE OR REPLACE FUNCTION public.transport_validate_vehicle_income_coa()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $validate$
BEGIN
 IF NEW.revenue_account_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public.chart_of_accounts a
   WHERE a.id=NEW.revenue_account_id AND a.company_id=NEW.company_id
     AND a.type='revenue' AND a.is_active AND NOT a.is_group
 ) THEN
   RAISE EXCEPTION 'Linked Vehicle Income COA must be an active Revenue account in the same company';
 END IF;
 RETURN NEW;
END
$validate$;
DROP TRIGGER IF EXISTS validate_transport_vehicle_income_coa ON public.transport_vehicles;
CREATE TRIGGER validate_transport_vehicle_income_coa
 BEFORE INSERT OR UPDATE OF company_id,revenue_account_id
 ON public.transport_vehicles FOR EACH ROW
 EXECUTE FUNCTION public.transport_validate_vehicle_income_coa();
REVOKE ALL ON FUNCTION public.transport_validate_vehicle_income_coa() FROM PUBLIC,anon,authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS transport_vehicle_income_coa_one_to_one
 ON public.transport_vehicles(company_id,revenue_account_id)
 WHERE revenue_account_id IS NOT NULL;

-- Existing Orbit COA accounts are explicit, pre-existing links. Don't create accounts
-- or invent accounts for 5731/2512; these can be linked in Vehicle Master after setup.
UPDATE public.transport_vehicles v
 SET revenue_account_id=a.id
 FROM public.chart_of_accounts a
 WHERE v.company_id='48bfc042-e65e-4398-98a6-3d4fd56e3efb'::uuid
 AND a.company_id=v.company_id
 AND ((v.vehicle_no='7979' AND a.code='4001' AND a.name='7979 Dyna Truck')
   OR (v.vehicle_no='7494' AND a.code='4002' AND a.name='7494 Flatbed Trialer'))
 AND a.type='revenue' AND a.is_active AND NOT a.is_group
 AND v.revenue_account_id IS NULL;

-- Every company-owned vehicle line uses its saved Revenue COA; unlinked vehicles fail closed.
-- Shared lines retain the user's selected general Revenue COA.
CREATE OR REPLACE FUNCTION public.transport_normal_invoice_create(p_side text, p_party uuid, p_date date, p_lines jsonb, p_account uuid, p_invoice_no text DEFAULT NULL::text, p_reference text DEFAULT NULL::text, p_post boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 c uuid:=public.current_company_id();
 b uuid:=public.current_business_unit_id();
 loc uuid:=public.current_operating_location_id();
 u uuid:=public.legacy_data_user_id();
 base text; mode text; tax numeric; doc uuid; number text; total numeric:=0;
 line jsonb; amount numeric; description text; line_count int:=0; outcome jsonb;
 selected_vehicle uuid; mapped_income uuid;
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
     exchange_rate,document_kind,payment_mode,total,outstanding_amount,payment_status)
   VALUES(u,c,b,loc,number,p_party,p_date,'draft',
     CASE WHEN mode='Credit' THEN 'Tax Invoice' ELSE 'Sale Invoice' END,tax,base,1,'service',mode,round(total*(1+tax/100),2),round(total*(1+tax/100),2),'unpaid') /* normal_open_balance_snapshot */
   RETURNING id INTO doc;
   FOR line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    selected_vehicle:=nullif(line->>'vehicle_id','')::uuid;
    mapped_income:=p_account;
    IF selected_vehicle IS NOT NULL THEN
      SELECT v.revenue_account_id INTO mapped_income
      FROM public.transport_vehicles v
      WHERE v.id=selected_vehicle AND v.company_id=c AND v.business_unit_id=b AND v.is_active
        AND EXISTS (
          SELECT 1 FROM public.transport_vehicle_ownership own
          WHERE own.vehicle_id=v.id AND own.company_id=c AND own.business_unit_id=b
            AND own.owner_type='company' AND own.effective_from<=p_date
            AND (own.effective_to IS NULL OR own.effective_to>=p_date)
        );
      IF mapped_income IS NULL THEN
        RAISE EXCEPTION 'Company-owned Vehicle % has no linked Income COA. Open Vehicle Master and link a Revenue account before creating this invoice',selected_vehicle;
      END IF;
      IF NOT EXISTS(
        SELECT 1 FROM public.chart_of_accounts a
        WHERE a.id=mapped_income AND a.company_id=c AND a.type='revenue'
          AND a.is_active AND NOT a.is_group
      ) THEN
        RAISE EXCEPTION 'Vehicle Income COA must be an active Revenue posting account in this company';
      END IF;
    END IF;
    INSERT INTO public.sales_service_lines(company_id,business_unit_id,order_id,description,amount,tax_percent,revenue_account_id,source_module,source_id,created_by)
    VALUES(c,b,doc,btrim(line->>'description'),(line->>'amount')::numeric,tax,mapped_income,
      CASE WHEN selected_vehicle IS NULL THEN 'transport_normal' ELSE 'transport_normal_vehicle' END,
      selected_vehicle,auth.uid());
   END LOOP;
   IF p_post THEN outcome:=public.post_sales_invoice(doc); END IF;
 ELSE
   INSERT INTO public.purchase_orders(user_id,company_id,business_unit_id,operating_location_id,
      order_no,supplier_id,order_date,status,invoice_type,tax_percent,currency_code,
      exchange_rate,document_kind,supplier_invoice_no,supplier_invoice_date,total,outstanding_amount,payment_status)
   VALUES(u,c,b,loc,number,p_party,p_date,'draft',
      CASE WHEN mode='Credit' THEN 'Tax Invoice' ELSE 'Purchase Invoice' END,
      tax,base,1,'service',coalesce(nullif(btrim(p_reference),''),number),p_date,round(total*(1+tax/100),2),round(total*(1+tax/100),2),'unpaid')
   RETURNING id INTO doc;
   FOR line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO public.purchase_service_lines(company_id,business_unit_id,order_id,description,amount,tax_percent,cost_account_id,source_module,source_id,created_by)
    VALUES(c,b,doc,btrim(line->>'description'),(line->>'amount')::numeric,tax,p_account,case when nullif(line->>'vehicle_id','') is null then 'transport_normal' else 'transport_normal_vehicle' end,nullif(line->>'vehicle_id','')::uuid,auth.uid());
   END LOOP;
   IF p_post THEN outcome:=public.post_purchase_invoice(doc); END IF;
 END IF;
 RETURN jsonb_build_object('side',p_side,'document_id',doc,'invoice_no',number,'lines',line_count,
   'net',total,'vat',round(total*tax/100,2),'gross',round(total*(1+tax/100),2),
   'status',CASE WHEN p_post THEN 'posted' ELSE 'draft' END,
   'journal_entry_id',outcome->>'journal_entry_id');
END
$function$
;
COMMIT;
