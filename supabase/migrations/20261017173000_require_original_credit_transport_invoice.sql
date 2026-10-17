-- Applied to production Supabase as require_original_number_before_credit_transport_sales_post.
-- Ensure single-trip and grouped Credit Transport Sales documents require an explicitly supplied invoice number.
DO $guard$
DECLARE f record; src text; patched text; needle text; insertion text;
BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('transport_post_customer_bill_accounted','transport_post_customer_bill_grouped')
 LOOP
  src:=pg_get_functiondef(f.oid);
  IF f.proname='transport_post_customer_bill_accounted' THEN
   needle:='  t:=public.transport_financial_trip(p_trip_id);';
   insertion:=needle||E'\n\n  if t.sale_type = ''credit'' and (nullif(btrim(p_invoice_no),'''') is null or btrim(p_invoice_no) like ''H-S-%'') then\n    raise exception ''Credit Transport Sales invoice requires your original invoice number before posting'';\n  end if;';
  ELSE
   needle:='  select base_currency_code into v_base_currency from public.companies where id=c;';
   insertion:=E'  if v_sale_type = ''credit'' and (nullif(btrim(p_invoice_no),'''') is null or btrim(p_invoice_no) like ''H-S-%'') then\n    raise exception ''Credit Transport Sales invoice requires your original invoice number before posting'';\n  end if;\n\n'||needle;
  END IF;
  IF position(needle in src)=0 THEN RAISE EXCEPTION 'Missing expected guard anchor for %',f.proname; END IF;
  IF position('Credit Transport Sales invoice requires your original invoice number before posting' in src)>0 THEN CONTINUE; END IF;
  patched:=replace(src,needle,insertion);
  EXECUTE patched;
 END LOOP;
END $guard$;
