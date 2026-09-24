DO $m$
DECLARE v text; n text;
BEGIN
  SELECT pg_get_functiondef('public.complete_work_order(uuid)'::regprocedure) INTO v;
  n := regexp_replace(v, 'where id=p_order_id and user_id=v_user_id and company_id=v_company_id\s+for update;', 'where id=p_order_id and user_id=v_user_id and company_id=v_company_id and business_unit_id=public.current_business_unit_id() for update;', 'i');
  IF n<>v THEN EXECUTE n; END IF;

  SELECT pg_get_functiondef('public.post_consolidated_sales_invoice(uuid)'::regprocedure) INTO v;
  n := regexp_replace(v, 'where id = p_invoice_id\s+and user_id = v_user_id\s+for update;', 'where id = p_invoice_id and user_id = v_user_id and company_id = public.current_company_id() and business_unit_id = public.current_business_unit_id() for update;', 'i');
  IF n=v THEN NULL; END IF; v:=n;
  n := regexp_replace(v, 'where l\.user_id = v_user_id\s+and l\.hawala_invoice_id = p_invoice_id', 'where l.user_id = v_user_id and l.company_id = public.current_company_id() and l.business_unit_id = public.current_business_unit_id() and l.hawala_invoice_id = p_invoice_id', 'i');
  IF n=v THEN NULL; END IF; v:=n;
  n := regexp_replace(v, 'where l\.invoice_id = p_invoice_id\s+and l\.user_id = v_user_id', 'where l.invoice_id = p_invoice_id and l.user_id = v_user_id and l.company_id = public.current_company_id() and l.business_unit_id = public.current_business_unit_id()', 'i');
  IF n=v THEN NULL; END IF; EXECUTE n;

  SELECT pg_get_functiondef('public.create_bank_reconciliation(uuid,date,date,numeric,numeric,text)'::regprocedure) INTO v;
  n := replace(v, 'where coa.id=p_account_id and coa.user_id=v_user and coa.is_active=true', 'where coa.id=p_account_id and coa.user_id=v_user and coa.company_id=public.current_company_id() and coa.is_active=true');
  IF n=v THEN NULL; END IF; v:=n;
  n := replace(v, 'where br.user_id=v_user and br.account_id=p_account_id and br.status=''draft''', 'where br.user_id=v_user and br.company_id=public.current_company_id() and br.business_unit_id=public.current_business_unit_id() and br.account_id=p_account_id and br.status=''draft''');
  IF n=v THEN NULL; END IF; v:=n;
  n := replace(v, 'where br.user_id=v_user and br.account_id=p_account_id and br.status=''closed''', 'where br.user_id=v_user and br.company_id=public.current_company_id() and br.business_unit_id=public.current_business_unit_id() and br.account_id=p_account_id and br.status=''closed''');
  IF n=v THEN NULL; END IF; EXECUTE n;

  SELECT pg_get_functiondef('public.cancel_bank_reconciliation(uuid)'::regprocedure) INTO v;
  n := replace(v, 'where id=p_reconciliation_id and user_id=v_user and status=''draft'';', 'where id=p_reconciliation_id and user_id=v_user and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and status=''draft'';');
  IF n=v THEN NULL; END IF; EXECUTE n;

  IF to_regprocedure('public.post_general_cash_bank_transaction(date,text,uuid,uuid,numeric,text,text,text)') IS NOT NULL THEN
    SELECT pg_get_functiondef('public.post_general_cash_bank_transaction(date,text,uuid,uuid,numeric,text,text,text)'::regprocedure) INTO v;
    n := regexp_replace(v, 'where id = p_counter_account_id\\s+and user_id = v_user_id;', 'where id = p_counter_account_id and user_id = v_user_id and company_id = public.current_company_id();', 'i');
    v:=n;
    n := regexp_replace(v, 'where id = p_cash_bank_account_id\\s+and user_id = v_user_id;', 'where id = p_cash_bank_account_id and user_id = v_user_id and company_id = public.current_company_id();', 'i');
    IF n<>v THEN EXECUTE n; END IF;
  END IF;

  SELECT pg_get_functiondef('public.get_available_hawala_invoices(uuid,uuid)'::regprocedure) INTO v;
  n := replace(v, 'on l.hawala_invoice_id=h.id and l.user_id=v_user and l.company_id=v_company', 'on l.hawala_invoice_id=h.id and l.user_id=v_user and l.company_id=v_company and l.business_unit_id=public.current_business_unit_id()');
  IF n=v THEN NULL; END IF; v:=n;
  n := replace(v, 'where h.user_id=v_user and h.company_id=v_company and h.customer_id=p_customer_id', 'where h.user_id=v_user and h.company_id=v_company and h.business_unit_id=public.current_business_unit_id() and h.customer_id=p_customer_id');
  IF n=v THEN NULL; END IF; EXECUTE n;

  SELECT pg_get_functiondef('public.reopen_final_gate_pass_for_correction(uuid,text)'::regprocedure) INTO v;
  n := regexp_replace(v, 'where id=p_gate_pass_id\s+for update;', 'where id=p_gate_pass_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() for update;', 'i');
  IF n=v THEN NULL; END IF; EXECUTE n;
END
$m$;
