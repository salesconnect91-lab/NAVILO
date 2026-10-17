CREATE OR REPLACE FUNCTION public.transport_credit_hs_unpaid_conversion_guard(p_sales_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id();
  j record; n integer; matching integer;
BEGIN
 IF c IS NULL OR b IS NULL THEN RAISE EXCEPTION 'Active company and business unit required'; END IF;
 PERFORM public.assert_module_permission('sales','post');
 PERFORM public.transport_credit_hs_unpaid_correction_gate(p_sales_order_id);
 SELECT * INTO j FROM public.transport_credit_hs_journal_pair_review(c)
 WHERE sales_order_id=p_sales_order_id AND verdict='BALANCED_PAIR_REVIEWED';
 IF NOT FOUND THEN RAISE EXCEPTION 'Journal pair not verified'; END IF;
 SELECT count(*),count(*) FILTER (WHERE v.status='posted'
   AND v.side='customer' AND v.order_id=p_sales_order_id
   AND v.invoice_journal_id=j.sales_journal_id
   AND v.reclass_journal_id=j.opening_journal_id
   AND v.clearing_journal_id IS NULL
   AND v.company_id=c AND v.business_unit_id=b)
 INTO n, matching FROM public.transport_register_invoice_conversions v
 JOIN public.transport_opening_invoice_lines l ON l.document_id=v.document_id AND l.side='customer'
 JOIN public.transport_customer_document_trips dt ON dt.trip_id=l.trip_id AND NOT dt.is_adjustment
 JOIN public.transport_customer_documents d ON d.id=dt.document_id AND d.sales_order_id=p_sales_order_id;
 IF n<>1 OR matching<>1 THEN RAISE EXCEPTION 'Posted conversion or journal mapping mismatch'; END IF;
 RETURN jsonb_build_object('eligible',true,'invoice_id',p_sales_order_id,
  'conversion_mapping','VERIFIED','status','READ_ONLY_NO_CORRECTION_APPLIED');
END
$fn$;
REVOKE ALL ON FUNCTION public.transport_credit_hs_unpaid_conversion_guard(uuid) FROM PUBLIC,anon,authenticated;