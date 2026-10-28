-- Keep vehicle expense reversals in cost, not income.
-- Ordinary vehicle-ledger credits are income and debits are cost; expense-document
-- reversals must reverse cost instead of being misclassified as revenue.
DO $migration$
DECLARE
  fn text := pg_get_functiondef('public.transport_vehicle_ledger(uuid,date,date,integer,integer)'::regprocedure);
  old_expr text := '   l.credit::numeric AS revenue,
   l.debit::numeric AS cost';
  new_expr text := $expr$   CASE WHEN (
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
   ) THEN 0::numeric ELSE l.credit::numeric END AS revenue,
   CASE WHEN (
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
   ) THEN (l.debit - l.credit)::numeric ELSE l.debit::numeric END AS cost$expr$;
BEGIN
  IF position(old_expr in fn) = 0 THEN
    IF position('original_expense.source_document_type = ''transport_vehicle_expense''' in fn) > 0
       AND position('THEN (l.debit - l.credit)::numeric ELSE l.debit::numeric END AS cost' in fn) > 0 THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Expected vehicle ledger expression not found; no change applied';
  END IF;
  fn := replace(fn, old_expr, new_expr);
  EXECUTE fn;
END
$migration$;