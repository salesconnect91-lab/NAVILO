BEGIN;

-- Restore vehicle-tagged manual journals to the vehicle ledger, while keeping
-- vehicle-expense source documents and their reversals deduplicated.
DO $vehicle_ledger_include_manual_journals$
DECLARE
  definition text;
  updated text;
  old_filter text := $old$
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
$old$;
  new_filter text := $new$
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
  OR (
    coalesce(j.source_document_type,'') = ''
    AND coalesce(j.trans_type,'') IN ('','Journal Entry','Manual Journal','Journal Reversal')
  )
)
$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.transport_vehicle_ledger(uuid,date,date,integer,integer)'::regprocedure
  ) INTO definition;
  IF definition IS NULL THEN
    RAISE EXCEPTION 'Missing transport_vehicle_ledger RPC';
  END IF;
  IF length(definition)-length(replace(definition,old_filter,'')) <> length(old_filter) THEN
    RAISE EXCEPTION 'Manual-journal filter differs from expected live function; refusing unsafe update';
  END IF;
  updated := replace(definition,old_filter,new_filter);
  EXECUTE updated;
  SELECT pg_get_functiondef(
    'public.transport_vehicle_ledger(uuid,date,date,integer,integer)'::regprocedure
  ) INTO definition;
  IF position('coalesce(j.trans_type,'''') IN ('''',''Journal Entry'',''Manual Journal'',''Journal Reversal'')' IN definition)=0 THEN
    RAISE EXCEPTION 'Manual journal filter verification failed';
  END IF;
END
$vehicle_ledger_include_manual_journals$;

COMMIT;
