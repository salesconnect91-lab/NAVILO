DO $migration$
DECLARE
  fn text := pg_get_functiondef('public.transport_vehicle_monthly_profit_report(date,date)'::regprocedure);
  old_expr text := $old$        (case
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
        end)::numeric as cost$old$;
  new_expr text := $new$        (case
          when j.source_document_type='transport_vehicle_expense'
            or (j.reversal_of_entry_id is not null and exists (
              select 1 from public.journal_entries original_expense
              where original_expense.id=j.reversal_of_entry_id
                and original_expense.company_id=j.company_id
                and original_expense.business_unit_id=j.business_unit_id
                and original_expense.source_document_type='transport_vehicle_expense'
            )) then l.debit-l.credit
          when j.reversal_of_entry_id is not null and exists (
            select 1 from public.journal_entries original_sales
            where original_sales.id=j.reversal_of_entry_id
              and original_sales.company_id=j.company_id
              and original_sales.business_unit_id=j.business_unit_id
              and original_sales.source_document_type='sales_invoice'
          ) then 0
          when a.type='expense' then l.debit-l.credit
          when a.type in ('revenue','income') then l.debit
          else 0
        end)::numeric as cost$new$;
BEGIN
  IF position(old_expr in fn)=0 THEN
    IF position('when j.reversal_of_entry_id is not null and exists' in fn)>0
       AND position('then 0' in substring(fn from greatest(position('when j.reversal_of_entry_id is not null and exists' in fn),1) for 1800))>0 THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'Expected vehicle monthly profit cost expression not found; no change applied';
  END IF;
  fn := replace(fn,old_expr,new_expr);
  EXECUTE fn;
END
$migration$;