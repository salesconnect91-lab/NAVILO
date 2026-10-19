-- Atomic non-inventory supplier Expense Invoice Excel import.
BEGIN;
CREATE OR REPLACE FUNCTION public.general_expense_bill_import(
  p_rows jsonb,p_post boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE grp record;val jsonb;count_rows integer;count_groups integer;
 supplier uuid;account uuid;date_ date;invoice text;vat_choice text;
 lines jsonb;results jsonb:='[]'::jsonb;group_rows jsonb;
BEGIN
 IF auth.uid() IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 200
  OR octet_length(p_rows::text)>300000 THEN
  RAISE EXCEPTION '1–200 valid Expense Invoice import lines required'; END IF;
 SELECT count(DISTINCT nullif(btrim(value->>'batch_ref'),'')) INTO count_groups
 FROM jsonb_array_elements(p_rows);
 IF count_groups NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION '1–50 Expense Invoice groups required';END IF;
 FOR grp IN SELECT btrim(value->>'batch_ref') key
      FROM jsonb_array_elements(p_rows) GROUP BY 1 ORDER BY 1 LOOP
  IF grp.key IS NULL OR length(grp.key)>80 THEN RAISE EXCEPTION 'Valid Invoice Group is required';END IF;
  SELECT jsonb_agg(value), count(*) INTO group_rows,count_rows
  FROM jsonb_array_elements(p_rows) WHERE btrim(value->>'batch_ref')=grp.key;
  val:=group_rows->0;
  supplier:=(val->>'supplier_id')::uuid;
  account:=(val->>'account_id')::uuid;
  date_:=(val->>'invoice_date')::date;
  invoice:=btrim(val->>'supplier_invoice_no');
  vat_choice:=lower(btrim(coalesce(val->>'vat_choice','without_vat')));
  IF vat_choice NOT IN ('with_vat','without_vat') THEN
    RAISE EXCEPTION 'Invoice group % requires With VAT or Without VAT',grp.key;END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(group_rows) x WHERE
     (x->>'supplier_id')::uuid IS DISTINCT FROM supplier
     OR (x->>'account_id')::uuid IS DISTINCT FROM account
     OR (x->>'invoice_date')::date IS DISTINCT FROM date_
     OR btrim(x->>'supplier_invoice_no') IS DISTINCT FROM invoice
     OR lower(btrim(coalesce(x->>'vat_choice','without_vat'))) IS DISTINCT FROM vat_choice)
  THEN RAISE EXCEPTION 'Mixed Supplier, account, date, reference or VAT within Invoice Group %',grp.key;END IF;
  SELECT jsonb_agg(jsonb_build_object('description',x->>'description','amount',x->>'amount'))
  INTO lines FROM jsonb_array_elements(group_rows) x;
  results:=results||jsonb_build_array(public.general_expense_bill_create(
   supplier,date_,invoice,account,lines,vat_choice='with_vat',p_post,NULL
  ));
 END LOOP;
 RETURN jsonb_build_object('invoices',count_groups,'lines',jsonb_array_length(p_rows),'documents',results);
END $$;
REVOKE ALL ON FUNCTION public.general_expense_bill_import(jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.general_expense_bill_import(jsonb,boolean) TO authenticated;
COMMIT;