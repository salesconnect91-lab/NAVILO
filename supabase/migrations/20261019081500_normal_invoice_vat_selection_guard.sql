-- Explicit VAT choice for trip-independent Normal Sale/Purchase invoices and bulk imports.
-- A selected VAT treatment must match the approved Customer/Supplier Master rule.
-- Original trip-linked invoices and their existing canonical RPCs stay untouched.
BEGIN;
CREATE OR REPLACE FUNCTION public.transport_normal_invoice_create_vat(
 p_side text,p_party uuid,p_date date,p_lines jsonb,p_account uuid,
 p_invoice_no text DEFAULT NULL,p_reference text DEFAULT NULL,
 p_post boolean DEFAULT true,p_vat_choice text DEFAULT 'master'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();mode text;rate numeric;
BEGIN
 IF auth.uid() IS NULL OR c IS NULL OR b IS NULL OR p_side NOT IN ('customer','supplier')
 OR p_party IS NULL OR p_date IS NULL OR p_vat_choice NOT IN ('master','with_vat','without_vat')
 THEN RAISE EXCEPTION 'Valid invoice VAT choice and authenticated Transport workspace required';END IF;
 mode:=public.transport_party_billing_mode(p_side,c,b,p_party);
 rate:=public.transport_billing_rate(c,p_side,p_date,mode);
 IF rate IS NULL THEN RAISE EXCEPTION 'Effective VAT rate for this party is not configured';END IF;
 IF (p_vat_choice='with_vat' AND rate<=0) OR (p_vat_choice='without_vat' AND rate<>0) THEN
   RAISE EXCEPTION 'VAT selection differs from Customer/Supplier Master Cash/Credit rule; update Master billing classification before posting';
 END IF;
 RETURN public.transport_normal_invoice_create(p_side,p_party,p_date,p_lines,p_account,p_invoice_no,p_reference,p_post);
END $$;
REVOKE ALL ON FUNCTION public.transport_normal_invoice_create_vat(text,uuid,date,jsonb,uuid,text,text,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_normal_invoice_create_vat(text,uuid,date,jsonb,uuid,text,text,boolean,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.transport_normal_invoice_import_vat(
 p_side text,p_rows jsonb,p_post boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r jsonb;choice text;expected text;mode text;rate numeric;
  groups jsonb:='{}'::jsonb;key text;c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();
BEGIN
 IF auth.uid() IS NULL OR c IS NULL OR b IS NULL OR p_side NOT IN ('customer','supplier')
 OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 200
 OR octet_length(p_rows::text)>300000 THEN RAISE EXCEPTION '1–200 valid invoice import rows required';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    choice:=coalesce(nullif(btrim(r->>'vat_choice'),''),'master');
    IF choice NOT IN ('master','with_vat','without_vat')
       THEN RAISE EXCEPTION 'VAT treatment must be Master, With VAT, or Without VAT';END IF;
    key:=lower(btrim(r->>'batch_ref'));
    IF key IS NULL OR key='' THEN RAISE EXCEPTION 'Invoice Group required';END IF;
    expected:=groups->>key;
    IF expected IS NOT NULL AND expected<>choice THEN
       RAISE EXCEPTION 'All lines of invoice group % must use same VAT treatment',key;
    END IF;
    groups:=jsonb_set(groups,array[key],to_jsonb(choice),true);
    IF choice<>'master' THEN
      mode:=public.transport_party_billing_mode(p_side,c,b,(r->>'party_id')::uuid);
      rate:=public.transport_billing_rate(c,p_side,(r->>'invoice_date')::date,mode);
      IF rate IS NULL OR (choice='with_vat' AND rate<=0) OR (choice='without_vat' AND rate<>0) THEN
        RAISE EXCEPTION 'Invoice group % VAT choice conflicts with Customer/Supplier Master Cash/Credit rule',key;
      END IF;
    END IF;
 END LOOP;
 RETURN public.transport_normal_invoice_import(p_side,p_rows,p_post);
END $$;
REVOKE ALL ON FUNCTION public.transport_normal_invoice_import_vat(text,jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_normal_invoice_import_vat(text,jsonb,boolean) TO authenticated;
COMMIT;
