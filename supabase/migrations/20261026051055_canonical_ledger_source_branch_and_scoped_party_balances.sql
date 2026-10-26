-- Keep canonical party ledger rows and their running balances in the source journal branch.
BEGIN;
CREATE OR REPLACE FUNCTION public.post_party_ledger_for_journal(p_journal_entry_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_user uuid:=public.legacy_data_user_id();v_company uuid:=public.current_company_id();v_unit uuid:=public.current_business_unit_id();
begin
 if v_user is null or v_company is null or v_unit is null then raise exception 'Authentication, active company and business unit are required.';end if;
 if not exists(select 1 from public.journal_entries where id=p_journal_entry_id and user_id=v_user and company_id=v_company and business_unit_id=v_unit and status='posted') then raise exception 'Posted journal entry not found in active business unit.';end if;
 insert into public.party_ledgers(user_id,company_id,business_unit_id,operating_location_id,party_type,party_id,entry_date,description,reference,debit,credit,balance,journal_entry_id,journal_line_id)
 select jl.user_id,v_company,v_unit,je.operating_location_id,jl.party_type,jl.party_id,je.entry_date,coalesce(nullif(jl.account,''),je.description),je.entry_no,round(coalesce(jl.debit,0),2),round(coalesce(jl.credit,0),2),0,je.id,jl.id
 from public.journal_lines jl join public.journal_entries je on je.id=jl.entry_id
 where jl.entry_id=p_journal_entry_id and jl.user_id=v_user and jl.company_id=v_company and jl.business_unit_id=v_unit and je.user_id=v_user and je.company_id=v_company and je.business_unit_id=v_unit and jl.party_type is not null and jl.party_id is not null and je.status='posted'
 on conflict (journal_line_id) where journal_line_id is not null do nothing;
end;$function$
;
CREATE OR REPLACE FUNCTION public.recalculate_party_ledger_balance()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_party_type text; v_party_id uuid; v_user_id uuid; v_unit uuid;v_company uuid;v_location uuid;
begin
 if tg_op='INSERT' and exists(
 select 1 from public.transport_register_conversion_gates g
 join public.transport_register_invoice_conversions v on v.document_id=g.document_id
 join public.journal_entries j on j.id=new.journal_entry_id
 where g.transaction_id=txid_current() and g.actor_id=auth.uid()
 and v.company_id=new.company_id and v.business_unit_id=new.business_unit_id
 and v.operating_location_id=new.operating_location_id
 and public.transport_register_conversion_allowed(g.order_id,g.side)
 and (j.source_document_id=v.order_id or j.source_document_id=v.document_id)
 and j.source_document_type in('sales_invoice','purchase_invoice','transport_historical_clearing','transport_opening_invoice_reclassification')
 ) then
 insert into public.transport_conversion_balance_queue values(txid_current(),auth.uid(),new.company_id,new.user_id,new.business_unit_id,new.party_type,new.party_id) on conflict do nothing;
 return new;
 end if;

 if tg_op='DELETE' then v_party_type:=old.party_type;v_party_id:=old.party_id;v_user_id:=old.user_id;v_unit:=old.business_unit_id;v_company:=old.company_id;v_location:=old.operating_location_id;
 else v_party_type:=new.party_type;v_party_id:=new.party_id;v_user_id:=new.user_id;v_unit:=new.business_unit_id;v_company:=new.company_id;v_location:=new.operating_location_id; end if;
 with running as (
   select id,sum(debit-credit) over(partition by user_id,company_id,business_unit_id,operating_location_id,party_type,party_id order by entry_date,created_at,id rows between unbounded preceding and current row) running_balance
   from public.party_ledgers where user_id=v_user_id and company_id=v_company and business_unit_id=v_unit and operating_location_id is not distinct from v_location and party_type=v_party_type and party_id=v_party_id
 ) update public.party_ledgers pl set balance=running.running_balance from running where pl.id=running.id and pl.balance is distinct from running.running_balance;
 return coalesce(new,old);
end;
$function$
;
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
  PERFORM public.assert_manual_journal_entry_feature(p_entry_id, 'post');
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
    company_id,
    business_unit_id,
    operating_location_id,
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
    je.company_id,
    je.business_unit_id,
    je.operating_location_id,
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
$function$
;
NOTIFY pgrst,'reload schema';
COMMIT;

