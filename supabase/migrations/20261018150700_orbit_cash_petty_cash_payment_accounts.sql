-- One-time controlled classification correction for Orbit – Usman Sajjad.
-- The original account IDs, account mappings, journal postings and balances remain intact.
-- No new COA records or journal/payment records are created.
BEGIN;
DO $$
DECLARE
 v_company uuid;
 v_authorized_owner uuid;
 v_cash uuid;
 v_petty uuid;
 v_count integer;
BEGIN
 SELECT id INTO STRICT v_company
 FROM public.companies
 WHERE name='Orbit - Usman Sajjad';

 -- Run as an actual active owner of this company, scoped to this transaction.
 -- Do not disable the tenant trigger or grant unrelated cross-company access.
 SELECT cm.user_id INTO STRICT v_authorized_owner
 FROM public.company_memberships cm
 JOIN public.user_profiles u ON u.id=cm.user_id AND u.is_active
 JOIN auth.users au ON au.id=cm.user_id
 WHERE cm.company_id=v_company AND cm.is_active
   AND cm.role='company_owner' AND u.last_company_id=v_company;
 PERFORM set_config('request.jwt.claim.sub',v_authorized_owner::text,true);
 IF public.current_company_id() IS DISTINCT FROM v_company
    OR NOT public.has_company_access(v_company) THEN
   RAISE EXCEPTION 'Verified Orbit owner context required before account correction';
 END IF;

 SELECT a.id INTO STRICT v_cash
 FROM public.chart_of_accounts a
 WHERE a.company_id=v_company AND a.name='Cash In Hand'
   AND a.type='asset' AND a.is_active AND NOT a.is_group
   AND a.allow_manual_entries AND a.detail_type IN ('fixed_assets','Cash on Hand')
   AND EXISTS(
     SELECT 1 FROM public.account_mappings m
     WHERE m.company_id=v_company AND m.mapping_key='cash' AND m.account_id=a.id
   );

 SELECT a.id INTO STRICT v_petty
 FROM public.chart_of_accounts a
 WHERE a.company_id=v_company AND a.name='Petty Cash'
   AND a.type='asset' AND a.is_active AND NOT a.is_group
   AND a.allow_manual_entries AND a.detail_type IN ('current_assets','Cash on Hand')
   AND NOT EXISTS(
     SELECT 1 FROM public.account_mappings m
     WHERE m.company_id=v_company AND m.account_id=a.id
       AND m.mapping_key IN ('bank','accounts_receivable','accounts_payable')
   );

 IF v_cash=v_petty THEN RAISE EXCEPTION 'Cash and Petty Cash account identity collision'; END IF;

 UPDATE public.chart_of_accounts
 SET detail_type='Cash on Hand'
 WHERE company_id=v_company AND id IN (v_cash,v_petty)
   AND detail_type IS DISTINCT FROM 'Cash on Hand';

 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count NOT IN (0,2) THEN
   RAISE EXCEPTION 'Unexpected partial Orbit Cash/Petty Cash correction: % rows',v_count;
 END IF;
 IF (SELECT count(*) FROM public.chart_of_accounts
     WHERE company_id=v_company AND id IN (v_cash,v_petty)
       AND type='asset' AND detail_type='Cash on Hand'
       AND is_active AND NOT is_group AND allow_manual_entries)<>2 THEN
   RAISE EXCEPTION 'Orbit cash account qualification failed after correction';
 END IF;
 RAISE NOTICE 'Orbit existing Cash In Hand and Petty Cash are payment-eligible with unchanged account IDs';
END $$;
COMMIT;