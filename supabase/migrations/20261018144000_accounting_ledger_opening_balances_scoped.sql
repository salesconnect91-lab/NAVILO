-- Date-filtered general and party statements require a true brought-forward balance.
-- Read-only, tenant scoped. Does not alter posted entries or accounting evidence.
BEGIN;
CREATE OR REPLACE FUNCTION public.accounting_ledger_opening_balances_scoped(
  p_before date,
  p_kind text DEFAULT 'general'
)
RETURNS TABLE(account_id uuid,party_type text,party_id uuid,opening_balance numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO public,pg_temp
AS $func$
DECLARE
 c uuid:=public.current_company_id();
 b uuid:=public.current_business_unit_id();
 loc uuid:=public.current_operating_location_id();
BEGIN
 IF auth.uid() IS NULL OR c IS NULL OR b IS NULL
    OR NOT public.has_module_permission(c,'accounting','view')
 THEN RAISE EXCEPTION 'Accounting view permission required'; END IF;
 IF loc IS NULL THEN RAISE EXCEPTION 'Active branch required for Ledger opening balances';END IF;
 IF p_before IS NULL THEN RAISE EXCEPTION 'Start date required';END IF;
 IF p_kind NOT IN ('general','party') THEN RAISE EXCEPTION 'Unsupported Ledger balance type';END IF;
 IF p_kind='general' THEN
  RETURN QUERY
  SELECT l.account_id,NULL::text,NULL::uuid,sum(l.debit-l.credit)::numeric
  FROM public.ledgers l
  JOIN public.journal_entries j ON j.id=l.journal_entry_id
  WHERE l.company_id=c AND j.company_id=c AND j.status='posted'
    AND l.business_unit_id=b AND l.operating_location_id=loc
    AND l.entry_date<p_before
    AND NOT EXISTS(SELECT 1 FROM public.owner_cancelled_journal_ids() x WHERE x.entry_id=j.id)
  GROUP BY l.account_id;
 ELSE
  RETURN QUERY
  SELECT NULL::uuid,l.party_type::text,l.party_id,sum(l.debit-l.credit)::numeric
  FROM public.party_ledgers l
  JOIN public.journal_entries j ON j.id=l.journal_entry_id
  WHERE l.company_id=c AND j.company_id=c AND j.status='posted'
    AND l.business_unit_id=b AND l.operating_location_id=loc
    AND l.entry_date<p_before
    AND NOT EXISTS(SELECT 1 FROM public.owner_cancelled_journal_ids() x WHERE x.entry_id=j.id)
  GROUP BY l.party_type,l.party_id;
 END IF;
END
$func$;
REVOKE ALL ON FUNCTION public.accounting_ledger_opening_balances_scoped(date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accounting_ledger_opening_balances_scoped(date,text) TO authenticated;
COMMIT;