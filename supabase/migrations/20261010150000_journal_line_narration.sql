-- Add optional per-line journal narration without rewriting existing journal evidence.
ALTER TABLE public.journal_lines ADD COLUMN IF NOT EXISTS description text;
COMMENT ON COLUMN public.journal_lines.description IS 'Optional line-specific narration for manual journal entry and its posted ledger.';
-- Both regular and foreign-currency posting routines insert ledgers with journal_line_id.
-- A BEFORE INSERT trigger fills the ledger description from the source line
-- while preserving the existing journal-level description as fallback.
CREATE OR REPLACE FUNCTION public.journal_ledger_line_narration()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_description text;
BEGIN
  IF NEW.journal_line_id IS NOT NULL THEN
    SELECT NULLIF(btrim(jl.description), '') INTO v_description
      FROM public.journal_lines jl
     WHERE jl.id = NEW.journal_line_id
       AND jl.entry_id = NEW.journal_entry_id
       AND jl.company_id = NEW.company_id
       AND jl.business_unit_id = NEW.business_unit_id;
    IF v_description IS NOT NULL THEN
      NEW.description := v_description;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS journal_ledger_line_narration_before_insert ON public.ledgers;
CREATE TRIGGER journal_ledger_line_narration_before_insert
BEFORE INSERT ON public.ledgers FOR EACH ROW
EXECUTE FUNCTION public.journal_ledger_line_narration();
