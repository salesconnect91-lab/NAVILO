-- Allow the generic accounting module tag used by the authenticated bulk
-- Journal importer. Actual source-document references remain blocked.
-- This preserves the manual journal posting guard for Income, Expense and VAT.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_manual_journal_nonbilling_post()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $guard$
BEGIN
  IF TG_OP='INSERT' THEN
    IF current_user='authenticated' AND (
        (NULLIF(btrim(coalesce(NEW.source_module,'')),'') IS NOT NULL
         AND lower(btrim(NEW.source_module)) <> 'accounting') OR
        NULLIF(btrim(coalesce(NEW.source_document_type,'')),'') IS NOT NULL OR
        NEW.source_document_id IS NOT NULL OR
        NEW.monthly_profit_closure_id IS NOT NULL OR
        NEW.fiscal_year_closure_id IS NOT NULL OR
        coalesce(NEW.trans_type,'') NOT IN ('','General','Journal Entry','Manual Journal')
    ) THEN
      RAISE EXCEPTION USING ERRCODE='23514',
        MESSAGE='Source-document references cannot be supplied through manual journal creation.';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'posted'
     OR OLD.status IS DISTINCT FROM 'draft' THEN
    RETURN NEW;
  END IF;

  IF coalesce(NEW.trans_type,'') NOT IN ('','General','Journal Entry','Manual Journal')
  THEN RETURN NEW; END IF;

  IF NEW.monthly_profit_closure_id IS NOT NULL
     OR NEW.fiscal_year_closure_id IS NOT NULL THEN RETURN NEW; END IF;

  IF NEW.reversal_of_entry_id IS NOT NULL THEN RETURN NEW; END IF;

  IF NULLIF(btrim(coalesce(NEW.source_document_type,'')), '') IS NOT NULL
     AND NULLIF(btrim(coalesce(NEW.source_module,'')), '') IS NOT NULL
     AND (
       NEW.source_document_id IS NOT NULL
       OR (NEW.source_module='payroll'
           AND NEW.source_document_type='salary_accrual'
           AND NEW.trans_type='Salary Accrual')
     )
  THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1
      FROM public.journal_lines l
      JOIN public.chart_of_accounts a ON a.id=l.account_id AND a.company_id=NEW.company_id
     WHERE l.entry_id=NEW.id AND l.company_id=NEW.company_id
       AND (
         lower(a.type) IN ('revenue','income','expense')
         OR a.code IN ('1150','2120')
         OR a.name ~* '(input|output)[[:space:]]+vat'
         OR EXISTS (
           SELECT 1 FROM public.account_mappings m
            WHERE m.company_id=NEW.company_id AND m.account_id=a.id
              AND m.mapping_key IN ('input_vat','output_vat')
         )
       )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Manual journals cannot post Income, Expense or VAT control accounts. Use the Sale/Expense Invoice workflow; authorized adjustments need a separate controlled process.';
  END IF;
  RETURN NEW;
END;
$guard$;

COMMIT;
