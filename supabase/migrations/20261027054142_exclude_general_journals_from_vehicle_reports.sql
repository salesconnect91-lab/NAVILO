-- General Journal rows remain in their original journal/GL history but are no longer
-- attributed to vehicle accounting reports. Source vehicle invoices, vehicle-expense
-- documents and reversals of those source documents remain reportable.
DO $no_general_journal_vehicle_reports$
DECLARE
  view_definition text;
  updated_view text;
  old_view_suffix text := 'AND has_module_permission(j.company_id, ''transport''::text, ''view''::text)';
  new_view_suffix text;
  function_name text;
  function_definition text;
  updated_function text;
  old_predicate text;
  new_predicate text := $source_only$
AND (
  j.source_document_type = 'transport_vehicle_expense'
  OR (
    j.reversal_of_entry_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.journal_entries original_expense
      WHERE original_expense.id = j.reversal_of_entry_id
        AND original_expense.company_id = j.company_id
        AND original_expense.business_unit_id = j.business_unit_id
        AND original_expense.source_document_type = 'transport_vehicle_expense'
    )
  )
)
$source_only$;
BEGIN
  SELECT pg_get_viewdef('public.transport_vehicle_manual_contributions'::regclass, true)
    INTO view_definition;
  new_view_suffix := old_view_suffix || ' AND (
    j.source_document_type = ''transport_vehicle_expense''
    OR (
      j.reversal_of_entry_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.journal_entries original_expense
        WHERE original_expense.id = j.reversal_of_entry_id
          AND original_expense.company_id = j.company_id
          AND original_expense.business_unit_id = j.business_unit_id
          AND original_expense.source_document_type = ''transport_vehicle_expense''
      )
    )
  )';
  IF length(view_definition)-length(replace(view_definition,old_view_suffix,'')) <> length(old_view_suffix) THEN
    RAISE EXCEPTION 'Vehicle manual contribution view changed; refusing unsafe filter';
  END IF;
  updated_view := replace(view_definition,old_view_suffix,new_view_suffix);
  EXECUTE 'CREATE OR REPLACE VIEW public.transport_vehicle_manual_contributions WITH (security_invoker=true) AS ' || updated_view;

  FOR function_name IN
    SELECT p.proname
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN ('transport_vehicle_ledger','transport_vehicle_monthly_profit_report')
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO function_definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=function_name;

    IF function_name='transport_vehicle_ledger' THEN
      old_predicate := 'AND coalesce(j.trans_type,'''') IN ('''',''Journal Entry'',''Manual Journal'',''Journal Reversal'')';
    ELSE
      old_predicate := 'and coalesce(j.trans_type,'''') in ('''',''Journal Entry'',''Manual Journal'',''Journal Reversal'')';
    END IF;
    IF length(function_definition)-length(replace(function_definition,old_predicate,'')) <> length(old_predicate) THEN
      RAISE EXCEPTION 'Vehicle report function % changed; refusing unsafe filter',function_name;
    END IF;
    updated_function := replace(function_definition,old_predicate,new_predicate);
    EXECUTE updated_function;
  END LOOP;
END
$no_general_journal_vehicle_reports$;

DO $verify_no_general_journal_vehicle_reports$
DECLARE
  view_definition text;
  ledger_definition text;
  monthly_definition text;
BEGIN
  SELECT pg_get_viewdef('public.transport_vehicle_manual_contributions'::regclass,true)
    INTO view_definition;
  SELECT pg_get_functiondef('public.transport_vehicle_ledger(uuid,date,date,integer,integer)'::regprocedure)
    INTO ledger_definition;
  SELECT pg_get_functiondef('public.transport_vehicle_monthly_profit_report(date,date)'::regprocedure)
    INTO monthly_definition;
  IF position('transport_vehicle_expense' IN view_definition)=0
     OR position('original_expense' IN view_definition)=0
     OR position('Journal Entry' IN ledger_definition)>0
     OR position('Journal Entry' IN monthly_definition)>0
     OR position('source_document_type = ''transport_vehicle_expense''' IN ledger_definition)=0
     OR position('source_document_type = ''transport_vehicle_expense''' IN monthly_definition)=0 THEN
    RAISE EXCEPTION 'Vehicle report filter verification failed';
  END IF;
END
$verify_no_general_journal_vehicle_reports$;