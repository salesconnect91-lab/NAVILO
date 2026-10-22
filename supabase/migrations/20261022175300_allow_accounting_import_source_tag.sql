-- The atomic manual journal importer uses source_module='accounting' to mark
-- generic journal imports. It does not link source documents; keep those
-- protected from direct client inserts.
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
      LEFT JOIN public.chart_of_accounts a
        ON a.id=l.account_id AND a.company_id=NEW.company_id
     WHERE l.entry_id=NEW.id AND l.company_id=NEW.company_id
       AND (
         a.id IS NULL
         OR coalesce(a.is_active,false)=false
         OR coalesce(a.is_group,true)=true
         OR coalesce(a.allow_manual_entries,false)=false
       )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Manual journals require active posting accounts with manual entries enabled.';
  END IF;

  RETURN NEW;
END;
$guard$;

DROP TRIGGER IF EXISTS a_guard_manual_journal_source_tags ON public.journal_entries;
CREATE TRIGGER a_guard_manual_journal_source_tags
BEFORE INSERT ON public.journal_entries
FOR EACH ROW
EXECUTE FUNCTION public.guard_manual_journal_nonbilling_post();

DROP TRIGGER IF EXISTS zzz_manual_journal_nonbilling_post ON public.journal_entries;
CREATE TRIGGER zzz_manual_journal_nonbilling_post
BEFORE UPDATE OF status ON public.journal_entries
FOR EACH ROW
WHEN (OLD.status='draft' AND NEW.status='posted')
EXECUTE FUNCTION public.guard_manual_journal_nonbilling_post();

COMMIT;
