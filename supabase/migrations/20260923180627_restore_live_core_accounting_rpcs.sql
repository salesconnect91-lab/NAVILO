-- Restore exact tenant-aware accounting RPC definitions recovered through
-- read-only production catalog inspection. This closes replay/catalog drift
-- without touching production data or migration history.

CREATE OR REPLACE FUNCTION public.initialize_default_coa()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  uid uuid := public.legacy_data_user_id();
  cid uuid := public.current_company_id();
BEGIN
  PERFORM public.assert_module_permission('accounting', 'create');
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Root groups
  INSERT INTO chart_of_accounts
    (user_id, code, name, type, is_group, normal_balance,
     allow_manual_entries, is_system_account, detail_type)
  VALUES
    (uid,'1000','Assets','asset',true,'debit',false,true,'Assets'),
    (uid,'2000','Liabilities','liability',true,'credit',false,true,'Liabilities'),
    (uid,'3000','Equity','equity',true,'credit',false,true,'Equity'),
    (uid,'4000','Revenue','revenue',true,'credit',false,true,'Revenue'),
    (uid,'5000','Cost of Sales','expense',true,'debit',false,true,'Cost of Sales'),
    (uid,'6000','Expenses','expense',true,'debit',false,true,'Expenses')
  ON CONFLICT DO NOTHING;

  -- Sub-groups
  INSERT INTO chart_of_accounts
    (user_id, code, name, type, parent_id, is_group,
     normal_balance, allow_manual_entries, is_system_account, detail_type)
  SELECT uid,'1100','Current Assets','asset',id,true,'debit',false,true,'Current Assets'
  FROM chart_of_accounts
  WHERE company_id=cid AND code='1000'
  ON CONFLICT DO NOTHING;

  INSERT INTO chart_of_accounts
    (user_id, code, name, type, parent_id, is_group,
     normal_balance, allow_manual_entries, is_system_account, detail_type)
  SELECT uid,'1200','Fixed Assets','asset',id,true,'debit',false,true,'Fixed Assets'
  FROM chart_of_accounts
  WHERE company_id=cid AND code='1000'
  ON CONFLICT DO NOTHING;

  INSERT INTO chart_of_accounts
    (user_id, code, name, type, parent_id, is_group,
     normal_balance, allow_manual_entries, is_system_account, detail_type)
  SELECT uid,'2100','Current Liabilities','liability',id,true,'credit',false,true,'Current Liabilities'
  FROM chart_of_accounts
  WHERE company_id=cid AND code='2000'
  ON CONFLICT DO NOTHING;

  -- Posting accounts
  INSERT INTO chart_of_accounts
    (user_id, code, name, type, parent_id, is_group,
     normal_balance, is_system_account, detail_type, account_role)
  SELECT
    uid,
    v.code,
    v.name,
    v.type,
    p.id,
    false,
    v.balance,
    true,
    v.detail_type,
    'system'
  FROM (
    VALUES
      ('1110','Cash','asset','debit','Cash on Hand','1100'),
      ('1120','Bank','asset','debit','Bank Account','1100'),
      ('1130','Accounts Receivable','asset','debit','Accounts Receivable','1100'),
      ('1140','Inventory','asset','debit','Inventory','1100'),
      ('1150','Input VAT','asset','debit','Input VAT','1100'),
      ('1210','Machinery & Equipment','asset','debit','Machinery & Equipment','1200'),
      ('2110','Accounts Payable','liability','credit','Accounts Payable','2100'),
      ('2120','Output VAT','liability','credit','Output VAT','2100'),
      ('3100','Share Capital','equity','credit','Share Capital','3000'),
      ('3200','Retained Earnings','equity','credit','Retained Earnings','3000'),
      ('4100','Sales Revenue','revenue','credit','Product Sales','4000'),
      ('4200','Service Revenue','revenue','credit','Service Revenue','4000'),
      ('5100','Cost of Goods Sold','expense','debit','COGS','5000'),
      ('6100','Salaries & Wages','expense','debit','Salaries','6000'),
      ('6200','Rent','expense','debit','Rent','6000'),
      ('6300','Utilities','expense','debit','Utilities','6000'),
      ('6400','Transport & Freight','expense','debit','Transport','6000'),
      ('6500','General Expenses','expense','debit','General Expenses','6000')
  ) AS v(code,name,type,balance,detail_type,parent_code)
  JOIN chart_of_accounts p
    ON p.company_id=cid
   AND p.code=v.parent_code
  ON CONFLICT DO NOTHING;

  -- Stable mappings
  INSERT INTO account_mappings(user_id, mapping_key, account_id)
  SELECT uid, v.mapping_key, a.id
  FROM (
    VALUES
      ('cash','1110'),
      ('bank','1120'),
      ('accounts_receivable','1130'),
      ('inventory','1140'),
      ('input_vat','1150'),
      ('accounts_payable','2110'),
      ('output_vat','2120'),
      ('sales_revenue','4100'),
      ('service_revenue','4200'),
      ('cogs','5100'),
      ('salary_expense','6100'),
      ('rent_expense','6200'),
      ('utilities_expense','6300'),
      ('transport_expense','6400'),
      ('general_expense','6500')
  ) AS v(mapping_key, account_code)
  JOIN chart_of_accounts a
    ON a.company_id=cid
   AND a.code=v.account_code
  ON CONFLICT DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_journal_entry(p_entry_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_status text;

  v_total_debit numeric := 0;
  v_total_credit numeric := 0;

  v_line_count integer := 0;
  v_invalid_count integer := 0;
  v_ledger_rows integer := 0;

  v_ar_account_id uuid;
  v_ap_account_id uuid;
BEGIN
  PERFORM public.assert_module_permission('accounting', 'post');
  SELECT
    je.user_id,
    je.status
  INTO
    v_user_id,
    v_status
  FROM public.journal_entries je
  WHERE je.id = p_entry_id
    AND je.user_id = public.legacy_data_user_id() AND je.company_id = public.current_company_id() AND je.business_unit_id = public.current_business_unit_id()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry not found.';
  END IF;

  IF v_status <> 'draft' THEN
    RAISE EXCEPTION
      'Only draft journal entries can be posted. Current status: %',
      v_status;
  END IF;

  SELECT am.account_id
  INTO v_ar_account_id
  FROM public.account_mappings am
  WHERE am.user_id = v_user_id AND am.company_id = public.current_company_id()
    AND am.mapping_key = 'accounts_receivable'
  LIMIT 1;

  SELECT am.account_id
  INTO v_ap_account_id
  FROM public.account_mappings am
  WHERE am.user_id = v_user_id AND am.company_id = public.current_company_id()
    AND am.mapping_key = 'accounts_payable'
  LIMIT 1;

  IF v_ar_account_id IS NULL THEN
    RAISE EXCEPTION 'Accounts Receivable mapping is missing.';
  END IF;

  IF v_ap_account_id IS NULL THEN
    RAISE EXCEPTION 'Accounts Payable mapping is missing.';
  END IF;

  SELECT
    COUNT(*),
    ROUND(COALESCE(SUM(jl.debit), 0), 2),
    ROUND(COALESCE(SUM(jl.credit), 0), 2)
  INTO
    v_line_count,
    v_total_debit,
    v_total_credit
  FROM public.journal_lines jl
  WHERE jl.entry_id = p_entry_id
    AND jl.user_id = v_user_id AND jl.company_id = public.current_company_id() AND jl.business_unit_id = public.current_business_unit_id();

  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'Cannot post an empty journal entry.';
  END IF;

  IF ABS(v_total_debit - v_total_credit) >= 0.01 THEN
    RAISE EXCEPTION
      'Journal is not balanced. Debit: %, Credit: %.',
      v_total_debit,
      v_total_credit;
  END IF;

  SELECT COUNT(*)
  INTO v_invalid_count
  FROM public.journal_lines jl
  LEFT JOIN public.chart_of_accounts coa
    ON coa.id = jl.account_id
   AND coa.user_id = v_user_id AND coa.company_id = public.current_company_id()
  WHERE jl.entry_id = p_entry_id
    AND jl.user_id = v_user_id AND jl.company_id = public.current_company_id() AND jl.business_unit_id = public.current_business_unit_id()
    AND (
      jl.account_id IS NULL
      OR coa.id IS NULL
      OR coa.is_active = false
      OR coa.is_group = true
      OR coa.allow_manual_entries = false

      OR COALESCE(jl.debit, 0) < 0
      OR COALESCE(jl.credit, 0) < 0

      OR (
        COALESCE(jl.debit, 0) > 0
        AND COALESCE(jl.credit, 0) > 0
      )

      OR (
        COALESCE(jl.debit, 0) <= 0
        AND COALESCE(jl.credit, 0) <= 0
      )

      OR (
        jl.party_type IS NULL
        AND jl.party_id IS NOT NULL
      )

      OR (
        jl.party_type IS NOT NULL
        AND jl.party_id IS NULL
      )
    );

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'One or more journal lines are invalid.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.journal_lines jl
    WHERE jl.entry_id = p_entry_id
      AND jl.user_id = v_user_id AND jl.company_id = public.current_company_id() AND jl.business_unit_id = public.current_business_unit_id()
      AND jl.account_id = v_ar_account_id
      AND (
        jl.party_type IS DISTINCT FROM 'customer'
        OR jl.party_id IS NULL
      )
  ) THEN
    RAISE EXCEPTION
      'Accounts Receivable lines require a Customer.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.journal_lines jl
    WHERE jl.entry_id = p_entry_id
      AND jl.user_id = v_user_id AND jl.company_id = public.current_company_id() AND jl.business_unit_id = public.current_business_unit_id()
      AND jl.account_id = v_ap_account_id
      AND (
        jl.party_type IS DISTINCT FROM 'supplier'
        OR jl.party_id IS NULL
      )
  ) THEN
    RAISE EXCEPTION
      'Accounts Payable lines require a Supplier.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.journal_lines jl
    WHERE jl.entry_id = p_entry_id
      AND jl.user_id = v_user_id AND jl.company_id = public.current_company_id() AND jl.business_unit_id = public.current_business_unit_id()
      AND jl.party_type = 'customer'
      AND (
        jl.account_id <> v_ar_account_id
        OR NOT EXISTS (
          SELECT 1
          FROM public.customers c
          WHERE c.id = jl.party_id
            AND c.user_id = v_user_id AND c.company_id = public.current_company_id()
            AND c.account_id = v_ar_account_id
        )
      )
  ) THEN
    RAISE EXCEPTION
      'One or more customer journal lines have an invalid Customer or Accounts Receivable account.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.journal_lines jl
    WHERE jl.entry_id = p_entry_id
      AND jl.user_id = v_user_id AND jl.company_id = public.current_company_id() AND jl.business_unit_id = public.current_business_unit_id()
      AND jl.party_type = 'supplier'
      AND (
        jl.account_id <> v_ap_account_id
        OR NOT EXISTS (
          SELECT 1
          FROM public.suppliers s
          WHERE s.id = jl.party_id
            AND s.user_id = v_user_id AND s.company_id = public.current_company_id()
            AND s.account_id = v_ap_account_id
        )
      )
  ) THEN
    RAISE EXCEPTION
      'One or more supplier journal lines have an invalid Supplier or Accounts Payable account.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ledgers l
    WHERE l.journal_entry_id = p_entry_id
      AND l.user_id = v_user_id AND l.company_id = public.current_company_id() AND l.business_unit_id = public.current_business_unit_id()
  ) THEN
    RAISE EXCEPTION
      'Ledger entries already exist for this journal entry.';
  END IF;

  INSERT INTO public.ledgers (
    user_id,
    journal_entry_id,
    journal_line_id,
    account_id,
    entry_date,
    description,
    debit,
    credit
  )
  SELECT
    v_user_id,
    p_entry_id,
    jl.id,
    jl.account_id,
    je.entry_date,
    CONCAT(
      je.entry_no,
      ' - ',
      COALESCE(NULLIF(je.description, ''), 'Journal Entry')
    ),
    ROUND(COALESCE(jl.debit, 0), 2),
    ROUND(COALESCE(jl.credit, 0), 2)
  FROM public.journal_lines jl
  JOIN public.journal_entries je
    ON je.id = jl.entry_id
  WHERE jl.entry_id = p_entry_id
    AND jl.user_id = v_user_id AND jl.company_id = public.current_company_id() AND jl.business_unit_id = public.current_business_unit_id();

  GET DIAGNOSTICS v_ledger_rows = ROW_COUNT;

  IF v_ledger_rows <> v_line_count THEN
    RAISE EXCEPTION
      'Ledger row count does not match journal line count.';
  END IF;

  UPDATE public.journal_entries
  SET status = 'posted'
  WHERE id = p_entry_id
    and user_id = v_user_id and company_id = public.current_company_id()
    AND status = 'draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry could not be posted.';
  END IF;

  PERFORM public.post_party_ledger_for_journal(p_entry_id);

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', p_entry_id,
    'total_debit', v_total_debit,
    'total_credit', v_total_credit,
    'ledger_rows_created', v_ledger_rows,
    'status', 'posted'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_manual_journal_entry(p_entry_id uuid, p_reversal_date date, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid:=public.legacy_data_user_id();v_company uuid:=public.current_company_id();v_unit uuid:=public.current_business_unit_id();v_original public.journal_entries%rowtype;v_reversal_id uuid;v_reversal_no text;v_post_result jsonb;
begin
 perform public.assert_module_permission('accounting','post');
 if v_user is null or v_company is null or v_unit is null then raise exception 'Authentication, active company and business unit are required.';end if;
 if p_reversal_date is null then raise exception 'Reversal date is required.';end if;if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Reversal reason is required.';end if;
 select * into v_original from public.journal_entries where id=p_entry_id and user_id=v_user and company_id=v_company and business_unit_id=v_unit for update;
 if not found then raise exception 'Journal entry was not found in active business unit.';end if;if v_original.status<>'posted' then raise exception 'Only a posted journal can be reversed.';end if;if p_reversal_date<v_original.entry_date then raise exception 'Reversal date cannot be earlier than original journal date.';end if;if v_original.reversal_of_entry_id is not null then raise exception 'A reversal journal cannot be reversed again.';end if;
 if coalesce(v_original.trans_type,'') not in('','Journal Entry','Manual Journal') or exists(select 1 from public.sales_orders where company_id=v_company and business_unit_id=v_unit and order_no=v_original.entry_no) or exists(select 1 from public.purchase_orders where company_id=v_company and business_unit_id=v_unit and order_no=v_original.entry_no) then raise exception 'Only manual journal entries can be reversed here. Use source document correction workflow.';end if;
 if exists(select 1 from public.journal_entries where company_id=v_company and business_unit_id=v_unit and reversal_of_entry_id=v_original.id) then raise exception 'This journal entry has already been reversed.';end if;
 if not exists(select 1 from public.journal_lines where entry_id=v_original.id and company_id=v_company and business_unit_id=v_unit) then raise exception 'Original journal has no lines to reverse.';end if;
 v_reversal_no:='REV-'||v_original.entry_no;
 insert into public.journal_entries(user_id,company_id,business_unit_id,entry_no,entry_date,description,status,payment_mode,party_name,trans_type,reversal_of_entry_id,reversal_reason)
 values(v_user,v_company,v_unit,v_reversal_no,p_reversal_date,'Reversal of '||v_original.entry_no||' - '||btrim(p_reason),'draft',v_original.payment_mode,v_original.party_name,'Journal Reversal',v_original.id,btrim(p_reason)) returning id into v_reversal_id;
 insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account_id,account,party_type,party_id,party_name,debit,credit)
 select v_user,v_company,v_unit,v_reversal_id,jl.account_id,jl.account,jl.party_type,jl.party_id,jl.party_name,round(coalesce(jl.credit,0),2),round(coalesce(jl.debit,0),2) from public.journal_lines jl where jl.entry_id=v_original.id and jl.company_id=v_company and jl.business_unit_id=v_unit;
 v_post_result:=public.post_journal_entry(v_reversal_id);
 insert into public.audit_logs(user_id,module,action,table_name,record_id,record_name,performed_by,old_data,new_data,metadata)
 values(v_user,'accounting','REVERSE','journal_entries',v_original.id,v_original.entry_no,v_user,jsonb_build_object('status',v_original.status),jsonb_build_object('reversal_entry_id',v_reversal_id),jsonb_build_object('business_unit_id',v_unit,'reversal_entry_no',v_reversal_no,'reversal_date',p_reversal_date,'reason',btrim(p_reason)));
 return jsonb_build_object('success',true,'original_entry_id',v_original.id,'reversal_entry_id',v_reversal_id,'reversal_entry_no',v_reversal_no,'business_unit_id',v_unit,'post_result',v_post_result);
end;$function$;

revoke all on function public.initialize_default_coa() from public, anon;
revoke all on function public.post_journal_entry(uuid) from public, anon;
revoke all on function public.reverse_manual_journal_entry(uuid,date,text) from public, anon;

grant execute on function public.initialize_default_coa() to authenticated, service_role;
grant execute on function public.post_journal_entry(uuid) to authenticated, service_role;
grant execute on function public.reverse_manual_journal_entry(uuid,date,text) to authenticated, service_role;

notify pgrst, 'reload schema';
