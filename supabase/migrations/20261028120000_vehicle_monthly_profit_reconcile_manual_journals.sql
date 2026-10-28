-- Keep monthly vehicle profit reporting consistent with the live vehicle ledger:
-- vehicle-account credits are income, debits are cost; expense-document reversals
-- reverse cost; include eligible manual journals while deduplicating contribution rows.
DO $migration$
DECLARE
  fn text := pg_get_functiondef('public.transport_vehicle_monthly_profit_report(date,date)'::regprocedure);
  old_expr text := $old$        (case when a.type in ('revenue','income') then l.credit-l.debit else 0 end)::numeric as revenue,
        (case when a.type='expense' then l.debit-l.credit else 0 end)::numeric as cost$old$;
  new_expr text := $new$        (case
          when j.source_document_type='transport_vehicle_expense'
            or (j.reversal_of_entry_id is not null and exists (
              select 1 from public.journal_entries original_expense
              where original_expense.id=j.reversal_of_entry_id
                and original_expense.company_id=j.company_id
                and original_expense.business_unit_id=j.business_unit_id
                and original_expense.source_document_type='transport_vehicle_expense'
            )) then 0
          when j.reversal_of_entry_id is not null and exists (
            select 1 from public.journal_entries original_sales
            where original_sales.id=j.reversal_of_entry_id
              and original_sales.company_id=j.company_id
              and original_sales.business_unit_id=j.business_unit_id
              and original_sales.source_document_type='sales_invoice'
          ) then l.credit-l.debit
          when a.type in ('revenue','income') then l.credit
          else 0
        end)::numeric as revenue,
        (case
          when j.source_document_type='transport_vehicle_expense'
            or (j.reversal_of_entry_id is not null and exists (
              select 1 from public.journal_entries original_expense
              where original_expense.id=j.reversal_of_entry_id
                and original_expense.company_id=j.company_id
                and original_expense.business_unit_id=j.business_unit_id
                and original_expense.source_document_type='transport_vehicle_expense'
            )) then l.debit-l.credit
          when a.type='expense' then l.debit-l.credit
          when a.type in ('revenue','income') then l.debit
          else 0
        end)::numeric as cost$new$;
  old_filter text := $filter$AND (
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
)$filter$;
  new_filter text := $filter$AND (
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
)$filter$;
BEGIN
  IF position(old_expr in fn)=0 OR position(old_filter in fn)=0 THEN
    IF position('when a.type in (''revenue'',''income'') then l.credit' in fn)>0
       AND position('coalesce(j.trans_type,'''') IN ('''',''Journal Entry'',''Manual Journal'',''Journal Reversal'')' in fn)>0 THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Expected monthly vehicle profit query not found; no change applied';
  END IF;
  fn := replace(fn,old_expr,new_expr);
  fn := replace(fn,old_filter,new_filter);
  EXECUTE fn;
END
$migration$;