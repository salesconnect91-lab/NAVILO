-- Shared source-reference claims prevent one expense from being posted through
-- multiple NAVILO import paths. Existing financial rows are preserved; only
-- non-financial identity evidence is backfilled.
BEGIN;

CREATE TABLE public.accounting_expense_source_claims (
  company_id uuid NOT NULL REFERENCES public.companies(id),
  business_unit_id uuid NOT NULL,
  source_reference text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN (
    'direct_cash_expense',
    'transport_vehicle_expense',
    'legacy_transport_expense',
    'supplier_invoice',
    'manual_journal'
  )),
  source_identity text NOT NULL,
  claim_state text NOT NULL DEFAULT 'reserved' CHECK (claim_state IN ('reserved','legacy_collision')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, business_unit_id, source_reference)
);
ALTER TABLE public.accounting_expense_source_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_expense_source_claims FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.accounting_expense_source_claims IS
  'Tenant-scoped idempotency claims for stable expense references shared by imports. Contains no accounting amounts.';

CREATE OR REPLACE FUNCTION public.accounting_claim_expense_source_reference(
  p_company_id uuid,
  p_business_unit_id uuid,
  p_source_reference text,
  p_source_kind text,
  p_source_identity text,
  p_created_by uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_reference text := lower(btrim(coalesce(p_source_reference,'')));
  v_existing public.accounting_expense_source_claims%rowtype;
BEGIN
  IF p_company_id IS NULL OR p_business_unit_id IS NULL OR v_reference = ''
     OR p_source_kind NOT IN (
       'direct_cash_expense','transport_vehicle_expense',
       'legacy_transport_expense','supplier_invoice','manual_journal'
     )
     OR nullif(btrim(p_source_identity),'') IS NULL THEN
    RAISE EXCEPTION 'Expense source identity is incomplete; provide a stable Source Reference.';
  END IF;

  INSERT INTO public.accounting_expense_source_claims
    (company_id,business_unit_id,source_reference,source_kind,source_identity,created_by)
  VALUES
    (p_company_id,p_business_unit_id,v_reference,p_source_kind,p_source_identity,p_created_by)
  ON CONFLICT (company_id,business_unit_id,source_reference) DO NOTHING;

  IF FOUND THEN RETURN; END IF;

  SELECT * INTO v_existing
  FROM public.accounting_expense_source_claims
  WHERE company_id=p_company_id
    AND business_unit_id=p_business_unit_id
    AND source_reference=v_reference
  FOR UPDATE;

  IF v_existing.claim_state='reserved'
     AND v_existing.source_kind=p_source_kind
     AND v_existing.source_identity=p_source_identity THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'Source Reference "%" is already claimed by %. Check the existing expense before retrying.',
    p_source_reference, coalesce(v_existing.source_kind,'another import')
    USING ERRCODE='23505';
END
$function$;
REVOKE ALL ON FUNCTION public.accounting_claim_expense_source_reference(uuid,uuid,text,text,text,uuid) FROM PUBLIC, anon, authenticated;

-- Fail closed if legacy rows already reuse one stable reference across
-- workflows. Do not modify or delete historical accounting data.
DO $preflight$
DECLARE v_collisions integer;
BEGIN
  WITH refs AS (
    SELECT company_id,business_unit_id,lower(btrim(source_reference)) reference
      FROM public.accounting_direct_cash_expense_import_keys
     WHERE nullif(btrim(source_reference),'') IS NOT NULL
    UNION ALL
    SELECT l.company_id,l.business_unit_id,lower(btrim(l.source_reference))
      FROM public.transport_vehicle_expense_document_lines l
     WHERE nullif(btrim(l.source_reference),'') IS NOT NULL
    UNION ALL
    SELECT company_id,business_unit_id,lower(btrim(source_reference))
      FROM public.transport_trip_expenses
     WHERE nullif(btrim(source_reference),'') IS NOT NULL
    UNION ALL
    SELECT company_id,business_unit_id,lower(btrim(supplier_invoice_no))
      FROM public.purchase_orders
     WHERE lower(status)='posted' AND document_kind IS DISTINCT FROM 'service'
       AND nullif(btrim(supplier_invoice_no),'') IS NOT NULL
    UNION ALL
    SELECT company_id,business_unit_id,lower(btrim(entry_no))
      FROM public.journal_entries
     WHERE status='posted'
       AND coalesce(source_module,'') IN ('','accounting')
       AND source_document_id IS NULL
       AND source_document_type IS NULL
       AND entry_no IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM public.journal_lines l
         JOIN public.chart_of_accounts a ON a.id=l.account_id AND a.company_id=l.company_id
         WHERE l.entry_id=journal_entries.id AND a.type='expense'
       )
  )
  SELECT count(*) INTO v_collisions
  FROM (SELECT company_id,business_unit_id,reference FROM refs
        GROUP BY company_id,business_unit_id,reference HAVING count(*)>1) duplicates;

  IF v_collisions>0 THEN
    RAISE EXCEPTION 'Found % historical expense source-reference collisions. No records changed; review these references before enabling shared claims.',v_collisions;
  END IF;
END
$preflight$;

-- Backfill stable source identities so the new guard also protects existing
-- posted expenses from a second import path.
INSERT INTO public.accounting_expense_source_claims
  (company_id,business_unit_id,source_reference,source_kind,source_identity,created_by,created_at)
SELECT company_id,business_unit_id,lower(btrim(source_reference)),'direct_cash_expense',
       'direct_cash:'||coalesce(journal_entry_id::text,lower(btrim(source_reference))),NULL,created_at
FROM public.accounting_direct_cash_expense_import_keys
WHERE nullif(btrim(source_reference),'') IS NOT NULL
UNION ALL
SELECT l.company_id,l.business_unit_id,lower(btrim(l.source_reference)),
       'transport_vehicle_expense',l.document_id::text,d.created_by,d.created_at
FROM public.transport_vehicle_expense_document_lines l
JOIN public.transport_vehicle_expense_documents d ON d.id=l.document_id
WHERE nullif(btrim(l.source_reference),'') IS NOT NULL
UNION ALL
SELECT company_id,business_unit_id,lower(btrim(source_reference)),
       'legacy_transport_expense',id::text,created_by,created_at
FROM public.transport_trip_expenses
WHERE nullif(btrim(source_reference),'') IS NOT NULL
UNION ALL
SELECT company_id,business_unit_id,lower(btrim(supplier_invoice_no)),
       'supplier_invoice',id::text,created_by,created_at
FROM public.purchase_orders
WHERE lower(status)='posted' AND document_kind IS DISTINCT FROM 'service'
  AND nullif(btrim(supplier_invoice_no),'') IS NOT NULL
UNION ALL
SELECT j.company_id,j.business_unit_id,lower(btrim(j.entry_no)),
       'manual_journal',j.id::text,coalesce(j.posted_by,j.created_by),j.created_at
FROM public.journal_entries j
WHERE j.status='posted'
  AND coalesce(j.source_module,'') IN ('','accounting')
  AND j.source_document_id IS NULL
  AND j.source_document_type IS NULL
  AND j.entry_no IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.journal_lines l
    JOIN public.chart_of_accounts a ON a.id=l.account_id AND a.company_id=l.company_id
    WHERE l.entry_id=j.id AND a.type='expense'
  );

CREATE OR REPLACE FUNCTION public.accounting_claim_direct_cash_expense_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public.accounting_claim_expense_source_reference(
    NEW.company_id,NEW.business_unit_id,NEW.source_reference,
    'direct_cash_expense',
    'direct_cash:'||lower(btrim(NEW.source_reference)),
    auth.uid()
  );
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.accounting_claim_direct_cash_expense_source() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS accounting_direct_cash_shared_source_claim ON public.accounting_direct_cash_expense_import_keys;
CREATE TRIGGER accounting_direct_cash_shared_source_claim
BEFORE INSERT ON public.accounting_direct_cash_expense_import_keys
FOR EACH ROW EXECUTE FUNCTION public.accounting_claim_direct_cash_expense_source();

CREATE OR REPLACE FUNCTION public.transport_claim_vehicle_expense_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public.accounting_claim_expense_source_reference(
    NEW.company_id,NEW.business_unit_id,NEW.source_reference,
    'transport_vehicle_expense',NEW.document_id::text,auth.uid()
  );
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.transport_claim_vehicle_expense_source() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS transport_vehicle_expense_shared_source_claim ON public.transport_vehicle_expense_document_lines;
CREATE TRIGGER transport_vehicle_expense_shared_source_claim
BEFORE INSERT OR UPDATE ON public.transport_vehicle_expense_document_lines
FOR EACH ROW EXECUTE FUNCTION public.transport_claim_vehicle_expense_source();

CREATE OR REPLACE FUNCTION public.transport_release_draft_vehicle_expense_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_reference text := lower(btrim(coalesce(OLD.source_reference,'')));
  v_status text;
BEGIN
  IF TG_OP='UPDATE' AND lower(btrim(coalesce(NEW.source_reference,'')))=v_reference THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_status
  FROM public.transport_vehicle_expense_documents WHERE id=OLD.document_id;

  IF v_reference<>'' AND (v_status IS NULL OR v_status='draft')
     AND NOT EXISTS (
       SELECT 1 FROM public.transport_vehicle_expense_document_lines other_line
       WHERE other_line.document_id=OLD.document_id
         AND lower(btrim(coalesce(other_line.source_reference,'')))=v_reference
         AND other_line.id IS DISTINCT FROM OLD.id
     ) THEN
    DELETE FROM public.accounting_expense_source_claims
    WHERE company_id=OLD.company_id
      AND business_unit_id=OLD.business_unit_id
      AND source_reference=v_reference
      AND source_kind='transport_vehicle_expense'
      AND source_identity=OLD.document_id::text;
  END IF;

  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END
$function$;
REVOKE ALL ON FUNCTION public.transport_release_draft_vehicle_expense_source() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS transport_vehicle_expense_release_source_claim ON public.transport_vehicle_expense_document_lines;
CREATE TRIGGER transport_vehicle_expense_release_source_claim
AFTER DELETE OR UPDATE ON public.transport_vehicle_expense_document_lines
FOR EACH ROW EXECUTE FUNCTION public.transport_release_draft_vehicle_expense_source();

CREATE OR REPLACE FUNCTION public.transport_claim_legacy_trip_expense_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF nullif(btrim(NEW.source_reference),'') IS NOT NULL THEN
    PERFORM public.accounting_claim_expense_source_reference(
      NEW.company_id,NEW.business_unit_id,NEW.source_reference,
      'legacy_transport_expense',NEW.id::text,coalesce(NEW.created_by,auth.uid())
    );
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.transport_claim_legacy_trip_expense_source() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS transport_trip_expense_shared_source_claim ON public.transport_trip_expenses;
CREATE TRIGGER transport_trip_expense_shared_source_claim
BEFORE INSERT OR UPDATE ON public.transport_trip_expenses
FOR EACH ROW EXECUTE FUNCTION public.transport_claim_legacy_trip_expense_source();

CREATE OR REPLACE FUNCTION public.accounting_claim_supplier_invoice_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF lower(coalesce(NEW.status,''))='posted'
     AND NEW.document_kind IS DISTINCT FROM 'service'
     AND nullif(btrim(NEW.supplier_invoice_no),'') IS NOT NULL THEN
    PERFORM public.accounting_claim_expense_source_reference(
      NEW.company_id,NEW.business_unit_id,NEW.supplier_invoice_no,
      'supplier_invoice',NEW.id::text,coalesce(NEW.created_by,auth.uid())
    );
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.accounting_claim_supplier_invoice_source() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS purchase_order_shared_expense_source_claim ON public.purchase_orders;
CREATE TRIGGER purchase_order_shared_expense_source_claim
AFTER INSERT OR UPDATE OF status,supplier_invoice_no ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.accounting_claim_supplier_invoice_source();

CREATE OR REPLACE FUNCTION public.accounting_claim_posted_manual_expense_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.status='posted'
     AND coalesce(NEW.source_module,'') IN ('','accounting')
     AND NEW.source_document_id IS NULL
     AND NEW.source_document_type IS NULL
     AND coalesce(NEW.trans_type,'') IN ('','General','Journal Entry','Manual Journal')
     AND NEW.entry_no IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.journal_lines l
       JOIN public.chart_of_accounts a ON a.id=l.account_id AND a.company_id=l.company_id
       WHERE l.entry_id=NEW.id AND a.type='expense'
     ) THEN
    PERFORM public.accounting_claim_expense_source_reference(
      NEW.company_id,NEW.business_unit_id,NEW.entry_no,
      'manual_journal',NEW.id::text,coalesce(NEW.posted_by,NEW.created_by,auth.uid())
    );
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.accounting_claim_posted_manual_expense_source() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS journal_entry_shared_expense_source_claim ON public.journal_entries;
CREATE TRIGGER journal_entry_shared_expense_source_claim
AFTER INSERT OR UPDATE OF status,entry_no ON public.journal_entries
FOR EACH ROW EXECUTE FUNCTION public.accounting_claim_posted_manual_expense_source();

NOTIFY pgrst,'reload schema';
COMMIT;
