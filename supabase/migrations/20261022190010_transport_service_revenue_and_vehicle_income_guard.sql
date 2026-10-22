BEGIN;

-- External transport invoices are service income. Never allow the client to
-- redirect these documents to Sales Revenue or an individual vehicle account.
CREATE OR REPLACE FUNCTION public.transport_import_external_invoices(
  p_source_company text,
  p_revenue_account_id uuid,
  p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE
  c uuid:=public.current_company_id();
  b uuid:=public.current_business_unit_id();
  loc uuid:=public.current_operating_location_id();
  u uuid:=auth.uid();
  g record;
  customer record;
  x jsonb;
  oid uuid;
  lid uuid;
  number text;
  base text;
  preview jsonb;
  invoices integer:=0;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'Sign in required'; END IF;
  PERFORM public.assert_module_permission('sales','create');
  PERFORM public.transport_finance_assert('billing');
  PERFORM pg_advisory_xact_lock(hashtextextended(c::text||b::text||':external-billing',0));
  preview:=public.transport_preview_external_invoices(p_source_company,p_rows);
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(preview->'rows') x
    WHERE x->>'import_status'<>'New'
  ) THEN RAISE EXCEPTION 'Import blocked: duplicate or invalid lines. Review the preview'; END IF;
  IF NOT EXISTS(
    SELECT 1
    FROM public.account_mappings am
    JOIN public.chart_of_accounts a ON a.id=am.account_id AND a.company_id=am.company_id
    WHERE am.company_id=c AND am.mapping_key='service_revenue'
      AND am.account_id=p_revenue_account_id
      AND a.type='revenue' AND a.is_active AND NOT a.is_group
  ) THEN RAISE EXCEPTION 'External transport invoices must use the active mapped Service Revenue account'; END IF;

  SELECT base_currency_code INTO base FROM public.companies WHERE id=c;
  FOR g IN
    SELECT coalesce(nullif(lower(btrim(x->>'invoice_no')),''),'cash:'||lower(btrim(x->>'source_reference'))) group_key,
      min(btrim(x->>'invoice_no')) invoice_no,
      min((x->>'invoice_date')::date) invoice_date,
      min(x->>'sale_type') sale_type,
      min(x->>'customer') customer_name,
      min((x->>'tax_percent')::numeric) tax,
      jsonb_agg(x) rows
    FROM jsonb_array_elements(p_rows) x GROUP BY 1
  LOOP
    SELECT * INTO customer FROM public.customers
    WHERE company_id=c AND is_active AND lower(btrim(name))=lower(btrim(g.customer_name));
    number:=public.transport_choose_invoice_number('customer',nullif(g.invoice_no,''));
    INSERT INTO public.sales_orders(
      user_id,company_id,business_unit_id,operating_location_id,order_no,customer_id,
      order_date,status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,
      payment_mode,created_by,transport_source_company,transport_source_invoice_id
    ) VALUES(
      customer.user_id,c,b,loc,number,customer.id,g.invoice_date,'draft',
      CASE WHEN g.sale_type='Credit' THEN 'Tax Invoice' ELSE 'Sale Invoice' END,
      g.tax,base,1,'service',g.sale_type,u,lower(btrim(p_source_company)),g.group_key
    ) RETURNING id INTO oid;
    FOR x IN SELECT value FROM jsonb_array_elements(g.rows) LOOP
      lid:=gen_random_uuid();
      INSERT INTO public.sales_service_lines(
        id,company_id,business_unit_id,order_id,description,amount,tax_percent,
        revenue_account_id,source_module,source_id,created_by
      ) VALUES(
        lid,c,b,oid,btrim(x->>'description'),(x->>'amount')::numeric,g.tax,
        p_revenue_account_id,'external_transport',lid,u
      );
      INSERT INTO public.transport_external_invoice_lines(
        id,company_id,business_unit_id,operating_location_id,sales_order_id,sales_line_id,
        source_company,source_reference,vehicle_id,vehicle_no,reference_trip_no,reference_date,
        truck_type,job_no,driver_name,owner_name,from_location,to_location
      )
      SELECT lid,c,b,loc,oid,lid,lower(btrim(p_source_company)),
        lower(btrim(x->>'source_reference')),v.id,v.vehicle_no,x->>'reference_trip_no',
        nullif(x->>'reference_date','')::date,x->>'truck_type',x->>'job_no',
        x->>'driver_name',x->>'owner_name',x->>'from_location',x->>'to_location'
      FROM public.transport_vehicles v
      WHERE v.company_id=c AND v.business_unit_id=b AND v.is_active
        AND lower(btrim(v.vehicle_no))=lower(btrim(x->>'vehicle_no'));
    END LOOP;
    invoices:=invoices+1;
  END LOOP;
  RETURN jsonb_build_object('invoices',invoices,'lines',jsonb_array_length(p_rows),'status','draft');
END
$function$;
REVOKE ALL ON FUNCTION public.transport_import_external_invoices(text,uuid,jsonb) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.transport_import_external_invoices(text,uuid,jsonb) TO authenticated;

-- Apply the same Service Revenue rule to the single and grouped Trip invoice RPCs.
-- These are generated from the same canonical grouped invoice definition, so only
-- the account-mapping validation is changed; VAT, trip and draft behavior stay intact.
DO $service_revenue_guard$
DECLARE
  function_signature text;
  function_definition text;
  function_updated text;
  signatures text[]:=ARRAY[
    'public.transport_post_customer_bill_grouped(uuid[],date,uuid,boolean,text,jsonb)',
    'public.transport_create_customer_draft_grouped(uuid[],date,uuid,boolean,text,jsonb)'
  ];
BEGIN
  FOREACH function_signature IN ARRAY signatures LOOP
    SELECT pg_get_functiondef(function_signature::regprocedure) INTO function_definition;
    IF function_definition IS NULL THEN
      RAISE EXCEPTION 'Missing expected Trip invoice RPC %',function_signature;
    END IF;
    function_updated:=replace(
      function_definition,
      'if p_revenue_account_id is null',
      'if p_revenue_account_id is null or not exists(select 1 from public.account_mappings am where am.company_id=c and am.mapping_key=''service_revenue'' and am.account_id=p_revenue_account_id)'
    );
    IF function_updated=function_definition THEN
      RAISE EXCEPTION 'Trip invoice account validation changed in %; refusing unsafe patch',function_signature;
    END IF;
    EXECUTE function_updated;
  END LOOP;
END
$service_revenue_guard$;

-- A vehicle's linked Income COA is for revenue credits. Prevent manual Journal
-- Entries from recording vehicle costs as debits to a revenue account. Existing
-- posted entries remain untouched; source-generated revenue adjustments remain valid.
CREATE OR REPLACE FUNCTION public.guard_transport_vehicle_income_debit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  e public.journal_entries%rowtype;
BEGIN
  IF coalesce(NEW.debit,0)<=0 THEN RETURN NEW; END IF;
  SELECT * INTO e FROM public.journal_entries WHERE id=NEW.entry_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF e.source_module IS NULL AND e.source_document_type IS NULL AND e.source_document_id IS NULL
     AND coalesce(e.trans_type,'') IN ('','General','Journal Entry','Manual Journal')
     AND EXISTS(
       SELECT 1 FROM public.transport_vehicles v
       JOIN public.business_units bu ON bu.id=v.business_unit_id
       WHERE v.company_id=NEW.company_id AND v.revenue_account_id=NEW.account_id
         AND bu.unit_type='transport'
     )
  THEN
    RAISE EXCEPTION 'Vehicle Income accounts are for revenue credits. Choose the correct expense account for this debit.';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.guard_transport_vehicle_income_debit() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_transport_vehicle_income_debit ON public.journal_lines;
CREATE TRIGGER guard_transport_vehicle_income_debit
  BEFORE INSERT OR UPDATE OF account_id,debit,entry_id ON public.journal_lines
  FOR EACH ROW EXECUTE FUNCTION public.guard_transport_vehicle_income_debit();

COMMIT;
