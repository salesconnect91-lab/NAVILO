-- Restore source-document reversal after standalone Journal Owner Control was tightened.
-- No posted data is changed by installing this function. Reversals are explicit,
-- owner-only, date-checked and produce one canonical opposite journal with audit.
BEGIN;
CREATE OR REPLACE FUNCTION public.transport_vehicle_expense_reverse(
  p_id uuid,p_date date,p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp
AS $function$
DECLARE
  c uuid:=public.current_company_id();
  b uuid:=public.current_business_unit_id();
  loc uuid:=public.current_operating_location_id();
  u uuid:=public.legacy_data_user_id();
  d public.transport_vehicle_expense_documents%rowtype;
  src public.journal_entries%rowtype;
  rev_id uuid;
  rev_no text;
  post_result jsonb;
  base_ccy text;
  n_lines integer;
  n_ledgers integer;
  total_debit numeric;
  total_credit numeric;
BEGIN
  IF NOT public.owner_posted_control_access() THEN
    RAISE EXCEPTION 'Company Owner or Platform Owner authorization is required for posted expense reversal';
  END IF;
  PERFORM public.assert_module_permission('transport','edit');
  PERFORM public.assert_module_permission('accounting','post');
  IF p_id IS NULL OR p_date IS NULL THEN
    RAISE EXCEPTION 'Vehicle Expense and reversal date are required';
  END IF;
  IF length(btrim(coalesce(p_reason,'')))<10 THEN
    RAISE EXCEPTION 'A reversal reason of at least 10 characters is required';
  END IF;
  IF c IS NULL OR b IS NULL OR loc IS NULL OR u IS NULL THEN
    RAISE EXCEPTION 'Active company, business unit and branch are required';
  END IF;
  SELECT * INTO d FROM public.transport_vehicle_expense_documents
   WHERE id=p_id AND company_id=c AND business_unit_id=b AND operating_location_id=loc
   FOR UPDATE;
  IF NOT FOUND OR d.status<>'posted' OR d.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Posted Vehicle Expense in the active workspace is required';
  END IF;
  SELECT * INTO src FROM public.journal_entries
   WHERE id=d.journal_entry_id AND company_id=c AND business_unit_id=b
     AND operating_location_id=loc AND user_id=u
   FOR UPDATE;
  IF NOT FOUND OR src.status<>'posted' THEN
    RAISE EXCEPTION 'Original posted expense Journal is missing';
  END IF;
  IF src.source_document_type IS DISTINCT FROM 'transport_vehicle_expense'
     OR src.source_document_id IS DISTINCT FROM d.id
     OR src.reversal_of_entry_id IS NOT NULL OR src.fiscal_year_closure_id IS NOT NULL
     OR src.monthly_profit_closure_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only the matching posted Vehicle Expense source may be reversed here';
  END IF;
  IF p_date<src.entry_date THEN
    RAISE EXCEPTION 'Reversal date cannot precede the original expense date';
  END IF;
  SELECT base_currency_code INTO base_ccy FROM public.companies WHERE id=c;
  IF base_ccy IS NULL OR coalesce(src.currency_code,base_ccy)<>base_ccy
     OR coalesce(src.exchange_rate,1)<>1 THEN
    RAISE EXCEPTION 'Foreign currency expense requires controlled FX-specific reversal';
  END IF;
  IF EXISTS(SELECT 1 FROM public.journal_entries WHERE company_id=c AND business_unit_id=b
       AND reversal_of_entry_id=src.id)
     OR EXISTS(SELECT 1 FROM public.owner_posted_control_events WHERE company_id=c
       AND business_unit_id=b AND document_type='transport_vehicle_expense'
       AND document_id=d.id AND action_type='reverse') THEN
    RAISE EXCEPTION 'This Vehicle Expense has already been reversed';
  END IF;
  SELECT count(*),coalesce(sum(debit),0),coalesce(sum(credit),0)
    INTO n_lines,total_debit,total_credit
    FROM public.journal_lines WHERE entry_id=src.id AND company_id=c AND business_unit_id=b;
  SELECT count(*) INTO n_ledgers FROM public.ledgers
    WHERE journal_entry_id=src.id AND company_id=c AND business_unit_id=b;
  IF n_lines<2 OR n_lines<>n_ledgers OR abs(total_debit-total_credit)>=0.01 THEN
    RAISE EXCEPTION 'Original expense Journal and Ledger are not reconciled';
  END IF;
  rev_no:='VEXP-REV-'||d.id::text;
  -- Required by the existing source-reversal guard; usable in this one transaction only.
  INSERT INTO public.transport_vehicle_expense_reverse_gate(transaction_id,document_id)
  VALUES(txid_current(),d.id);
  INSERT INTO public.journal_entries(
    user_id,company_id,business_unit_id,operating_location_id,
    entry_no,entry_date,description,status,payment_mode,party_name,trans_type,
    reversal_of_entry_id,reversal_reason,currency_code,exchange_rate,
    accounting_dimension_id
  ) VALUES(
    u,c,b,loc,rev_no,p_date,'Vehicle Expense reversal '||src.entry_no||': '||btrim(p_reason),
    'draft',src.payment_mode,src.party_name,'Journal Reversal',
    src.id,btrim(p_reason),base_ccy,1,src.accounting_dimension_id
  ) RETURNING id INTO rev_id;
  INSERT INTO public.journal_lines(
    user_id,company_id,business_unit_id,operating_location_id,entry_id,
    account_id,account,party_type,party_id,party_name,debit,credit,
    accounting_dimension_id,transport_vehicle_id,transport_vehicle_no
  )
  SELECT u,c,b,loc,rev_id,account_id,account,party_type,party_id,party_name,
    round(coalesce(credit,0),2),round(coalesce(debit,0),2),
    accounting_dimension_id,transport_vehicle_id,transport_vehicle_no
  FROM public.journal_lines WHERE entry_id=src.id AND company_id=c AND business_unit_id=b;
  post_result:=public.post_journal_entry(rev_id);
  IF coalesce(post_result->>'status','')<>'posted' THEN
    RAISE EXCEPTION 'Vehicle Expense reversal failed to post';
  END IF;
  IF (SELECT count(*) FROM public.ledgers
      WHERE journal_entry_id=rev_id AND company_id=c AND business_unit_id=b)<>n_lines
     OR EXISTS(
       SELECT 1 FROM (
         SELECT account_id,coalesce(sum(debit-credit),0) diff
         FROM public.journal_lines WHERE entry_id IN (src.id,rev_id)
         GROUP BY account_id
       ) net WHERE abs(net.diff)>=0.01
     ) THEN
    RAISE EXCEPTION 'Expense reversal is not fully reconciled account-by-account';
  END IF;
  DELETE FROM public.transport_vehicle_expense_reverse_gate
  WHERE transaction_id=txid_current() AND document_id=d.id;
  UPDATE public.transport_vehicle_expense_documents
  SET status='reversed',reversal_entry_id=rev_id,updated_at=now()
  WHERE id=d.id AND company_id=c AND business_unit_id=b;
  INSERT INTO public.owner_posted_control_events(
    company_id,business_unit_id,document_type,document_id,action_type,
    reason,performed_by,reversal_document_id,metadata
  ) VALUES(
    c,b,'transport_vehicle_expense',d.id,'reverse',btrim(p_reason),auth.uid(),rev_id,
    jsonb_build_object('original_entry_id',src.id,'reversal_entry_id',rev_id,
      'original_date',src.entry_date,'reversal_date',p_date,
      'original_debit',total_debit,'original_credit',total_credit,
      'reason','source-document correction')
  );
  PERFORM public.log_admin_posted_action(c,'accounting',
    'transport_vehicle_expense_documents',d.id,d.expense_group,
    'OWNER_REVERSE',btrim(p_reason),
    jsonb_build_object('status','posted','journal_entry_id',src.id),
    jsonb_build_object('status','reversed','reversal_entry_id',rev_id,
      'financial_evidence_preserved',true));
  RETURN jsonb_build_object('success',true,'status','reversed',
    'document_id',d.id,'original_entry_id',src.id,
    'reversal_entry_id',rev_id,'reversal_entry_no',rev_no,
    'financial_evidence_preserved',true);
END;
$function$;
REVOKE ALL ON FUNCTION public.transport_vehicle_expense_reverse(uuid,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_vehicle_expense_reverse(uuid,date,text) TO authenticated;
COMMIT;