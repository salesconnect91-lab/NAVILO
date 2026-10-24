-- Owner-only in-place correction of standalone, base-currency posted manual journals.
-- Reject linked party and source documents; no reversal, no adjusting entries.
CREATE OR REPLACE FUNCTION public.owner_edit_posted_manual_journal(
 p_entry_id uuid, p_reason text, p_entry_date date, p_description text, p_lines jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
 v_entry public.journal_entries%rowtype;
 v_old jsonb; v_new jsonb; v_count integer; v_line jsonb;
 v_line_id uuid; v_debit numeric; v_credit numeric;
 v_sum_debit numeric := 0; v_sum_credit numeric := 0;
 v_ledger_count integer; v_old_count integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.company_can_permanently_delete() THEN
  RAISE EXCEPTION 'Owner Control permission required';
 END IF;
 IF length(trim(coalesce(p_reason,''))) < 10 THEN RAISE EXCEPTION 'Reason must contain at least 10 characters'; END IF;
 IF p_entry_date IS NULL OR p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
  RAISE EXCEPTION 'Date and journal lines required';
 END IF;
 SELECT * INTO v_entry FROM public.journal_entries WHERE id=p_entry_id FOR UPDATE;
 IF NOT FOUND OR v_entry.status <> 'posted' OR v_entry.company_id IS DISTINCT FROM public.current_company_id()
    OR v_entry.business_unit_id IS DISTINCT FROM public.current_business_unit_id()
    OR v_entry.reversal_of_entry_id IS NOT NULL OR v_entry.source_document_id IS NOT NULL
    OR v_entry.source_document_type IS NOT NULL OR v_entry.source_module IS DISTINCT FROM 'accounting'
    OR v_entry.fiscal_year_closure_id IS NOT NULL OR v_entry.monthly_profit_closure_id IS NOT NULL
    OR v_entry.entry_no LIKE 'COB-%'
    OR coalesce(v_entry.trans_type,'General') NOT IN ('General','Journal Entry','Manual Journal')
 THEN RAISE EXCEPTION 'Only standalone posted accounting journals in active company may be edited'; END IF;
 IF v_entry.currency_code IS NOT NULL AND v_entry.currency_code IS DISTINCT FROM
  (SELECT base_currency_code FROM public.companies WHERE id=v_entry.company_id) THEN
  RAISE EXCEPTION 'Foreign-currency journals require a separate FX-safe correction'; END IF;
 IF EXISTS (SELECT 1 FROM public.party_ledgers WHERE journal_entry_id=p_entry_id) THEN
  RAISE EXCEPTION 'Party-linked journals require synchronized party ledger correction'; END IF;
 SELECT count(*) INTO v_old_count FROM public.journal_lines WHERE entry_id=p_entry_id;
 IF v_old_count < 2 OR jsonb_array_length(p_lines) <> v_old_count THEN
  RAISE EXCEPTION 'All original journal lines must be supplied; adding/removing lines is not supported'; END IF;
 SELECT count(*) INTO v_ledger_count FROM public.ledgers WHERE journal_entry_id=p_entry_id;
 IF v_ledger_count <> v_old_count OR EXISTS (
  SELECT 1 FROM public.journal_lines jl WHERE jl.entry_id=p_entry_id
  AND (SELECT count(*) FROM public.ledgers l WHERE l.journal_line_id=jl.id AND l.journal_entry_id=p_entry_id) <> 1
 ) THEN RAISE EXCEPTION 'Journal ledger mapping is incomplete; correction blocked'; END IF;
 IF EXISTS (SELECT 1 FROM public.journal_lines WHERE entry_id=p_entry_id AND party_id IS NOT NULL) THEN
  RAISE EXCEPTION 'Party-linked journal lines cannot be edited here'; END IF;
 SELECT jsonb_build_object('header',to_jsonb(v_entry),'lines',
   (SELECT jsonb_agg(to_jsonb(jl) ORDER BY jl.id) FROM public.journal_lines jl WHERE jl.entry_id=p_entry_id),
   'ledgers',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.ledgers l WHERE l.journal_entry_id=p_entry_id))
 INTO v_old;
 FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  v_line_id := (v_line->>'id')::uuid;
  v_debit := (v_line->>'debit')::numeric;
  v_credit := (v_line->>'credit')::numeric;
  IF v_line_id IS NULL OR v_debit IS NULL OR v_credit IS NULL OR v_debit < 0 OR v_credit < 0
    OR (v_debit > 0 AND v_credit > 0) OR (v_debit = 0 AND v_credit = 0)
    OR round(v_debit,2) <> v_debit OR round(v_credit,2) <> v_credit THEN
   RAISE EXCEPTION 'Each line requires a valid debit or credit amount (2 decimals)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.journal_lines WHERE id=v_line_id AND entry_id=p_entry_id) THEN
   RAISE EXCEPTION 'Journal line does not belong to this entry';
  END IF;
  v_sum_debit := v_sum_debit + v_debit; v_sum_credit := v_sum_credit + v_credit;
 END LOOP;
 SELECT count(DISTINCT (value->>'id')) INTO v_count FROM jsonb_array_elements(p_lines);
 IF v_count <> v_old_count OR v_sum_debit <= 0 OR v_sum_debit <> v_sum_credit THEN
  RAISE EXCEPTION 'Journal must contain unique lines and balanced debit/credit';
 END IF;
 PERFORM set_config('app.maintenance_reset','1',true);
 UPDATE public.journal_entries SET entry_date=p_entry_date,description=p_description WHERE id=p_entry_id;
 FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  v_line_id := (v_line->>'id')::uuid;
  v_debit := (v_line->>'debit')::numeric; v_credit := (v_line->>'credit')::numeric;
  UPDATE public.journal_lines SET debit=v_debit,credit=v_credit,
    base_debit=v_debit,base_credit=v_credit,source_debit=v_debit,source_credit=v_credit,
    description=coalesce(v_line->>'description','') WHERE id=v_line_id AND entry_id=p_entry_id;
  UPDATE public.ledgers SET debit=v_debit,credit=v_credit,entry_date=p_entry_date,
    description=coalesce(v_line->>'description',p_description) WHERE journal_entry_id=p_entry_id AND journal_line_id=v_line_id;
 END LOOP;
 SELECT jsonb_build_object('header',to_jsonb(je),'lines',
   (SELECT jsonb_agg(to_jsonb(jl) ORDER BY jl.id) FROM public.journal_lines jl WHERE jl.entry_id=p_entry_id),
   'ledgers',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.ledgers l WHERE l.journal_entry_id=p_entry_id))
 INTO v_new FROM public.journal_entries je WHERE je.id=p_entry_id;
 INSERT INTO public.owner_posted_control_events
 (company_id,business_unit_id,document_type,document_id,action_type,reason,performed_by,metadata)
 VALUES (v_entry.company_id,v_entry.business_unit_id,'manual_journal',p_entry_id,'owner_edit_posted',
 trim(p_reason),auth.uid(),jsonb_build_object('before',v_old,'after',v_new));
 RETURN jsonb_build_object('success',true,'entry_id',p_entry_id);
END $fn$;
REVOKE ALL ON FUNCTION public.owner_edit_posted_manual_journal(uuid,text,date,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_edit_posted_manual_journal(uuid,text,date,text,jsonb) TO authenticated;