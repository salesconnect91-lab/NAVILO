BEGIN;

-- Custom GUCs are client-settable; maintenance mode must also be server-authenticated.
CREATE OR REPLACE FUNCTION public.guard_journal_entry_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_legacy_user_id uuid;
  v_company_id uuid;
  v_manual_posted boolean;
BEGIN
  IF coalesce(current_setting('app.maintenance_reset', true), '0') = '1'
     AND public.navilo_request_role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_legacy_user_id := public.legacy_data_user_id();
    v_company_id := public.current_company_id();
    IF NEW.user_id IS NULL THEN NEW.user_id := coalesce(v_legacy_user_id, auth.uid()); END IF;
    IF auth.uid() IS NOT NULL AND NEW.user_id IS DISTINCT FROM auth.uid()
       AND NEW.user_id IS DISTINCT FROM v_legacy_user_id THEN
      RAISE EXCEPTION 'Journal entry owner is invalid.';
    END IF;
    IF v_company_id IS NOT NULL AND NEW.company_id IS NOT NULL
       AND NEW.company_id IS DISTINCT FROM v_company_id THEN
      RAISE EXCEPTION 'Journal entry company is invalid.';
    END IF;
    IF current_user = 'authenticated' AND coalesce(NEW.status, 'draft') <> 'draft' THEN
      RAISE EXCEPTION 'New journal entries must be created as draft.';
    END IF;
    RETURN NEW;
  END IF;

  v_manual_posted := OLD.status = 'posted'
    AND OLD.source_module IS NULL AND OLD.source_document_type IS NULL
    AND OLD.source_document_id IS NULL AND OLD.reversal_of_entry_id IS NULL
    AND OLD.fiscal_year_closure_id IS NULL AND OLD.monthly_profit_closure_id IS NULL;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' AND NOT (v_manual_posted AND public.owner_posted_control_access()) THEN
      RAISE EXCEPTION 'Posted journal entry is locked. Correct it through its source module; only authorized Owner/Admin may delete a manual posted journal.';
    END IF;
    IF OLD.status = 'posted' AND v_manual_posted AND NOT public.owner_posted_control_access() THEN
      RAISE EXCEPTION 'Only authorized Owner/Admin can delete a posted manual journal.';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN RAISE EXCEPTION 'Journal entry owner cannot be changed.'; END IF;
  IF OLD.status = 'posted' THEN
    IF NOT (v_manual_posted AND public.owner_posted_control_access()) THEN
      RAISE EXCEPTION 'Posted journal entry is locked. Correct it through its source module.';
    END IF;
    IF NEW.source_module IS NOT NULL OR NEW.source_document_type IS NOT NULL
       OR NEW.source_document_id IS NOT NULL OR NEW.reversal_of_entry_id IS NOT NULL
       OR NEW.fiscal_year_closure_id IS NOT NULL OR NEW.monthly_profit_closure_id IS NOT NULL THEN
      RAISE EXCEPTION 'A manual journal cannot be converted into a source-linked or reversal entry.';
    END IF;
    IF NEW.status <> 'posted' THEN RAISE EXCEPTION 'Posted manual journals must remain posted during authorized edits.'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'posted' AND NEW.status = 'posted' AND current_user = 'authenticated' THEN
    RAISE EXCEPTION 'Use the journal posting process to post this entry.';
  END IF;
  IF NEW.status NOT IN ('draft', 'posted') THEN RAISE EXCEPTION 'Invalid journal status.'; END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.guard_posted_journal_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_policy public.company_accounting_policies%rowtype;
  v_manual_posted boolean;
BEGIN
  IF coalesce(current_setting('app.maintenance_reset', true), '0') = '1'
     AND public.navilo_request_role() = 'service_role' THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  v_manual_posted := OLD.status = 'posted'
    AND OLD.source_module IS NULL AND OLD.source_document_type IS NULL
    AND OLD.source_document_id IS NULL AND OLD.reversal_of_entry_id IS NULL
    AND OLD.fiscal_year_closure_id IS NULL AND OLD.monthly_profit_closure_id IS NULL;

  IF OLD.status = 'posted' AND v_manual_posted AND public.owner_posted_control_access() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF NEW.status = 'posted' AND NEW.source_module IS NULL
       AND NEW.source_document_type IS NULL AND NEW.source_document_id IS NULL
       AND NEW.reversal_of_entry_id IS NULL AND NEW.fiscal_year_closure_id IS NULL
       AND NEW.monthly_profit_closure_id IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Authorized edits are limited to manual posted journals; source and reversal links cannot be changed.';
  END IF;

  SELECT * INTO v_policy FROM public.company_accounting_policies WHERE company_id = OLD.company_id;
  IF OLD.status = 'posted' AND coalesce(v_policy.enforce_posted_immutability, true) THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Posted journal entries cannot be deleted directly; use the source module.'; END IF;
    IF NEW.status = 'posted' AND ROW(OLD.entry_no, OLD.entry_date, OLD.description, OLD.company_id, OLD.business_unit_id, OLD.payment_mode, OLD.party_name, OLD.trans_type)
       IS DISTINCT FROM ROW(NEW.entry_no, NEW.entry_date, NEW.description, NEW.company_id, NEW.business_unit_id, NEW.payment_mode, NEW.party_name, NEW.trans_type) THEN
      RAISE EXCEPTION 'Posted journal entries are immutable; edit manual journals only through authorized controls.';
    END IF;
  END IF;
  RETURN coalesce(NEW, OLD);
END
$function$;

COMMIT;