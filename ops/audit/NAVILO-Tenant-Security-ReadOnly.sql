-- NAVILO multi-tenant production safety: READ-ONLY (run using a privileged audit login).
-- Only SELECT; do not use SET ROLE, ALTER, UPDATE, or cross-user credential replay.
-- A zero result for mismatch checks does NOT prove RLS isolation; test real restricted
-- logins in a separate test environment before activating each new company.

-- 1. Core tenant tables must retain RLS and permissions.
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policy_count,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_has_select_grant
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN
 ('companies','company_memberships','business_unit_memberships','customers','suppliers',
  'chart_of_accounts','sales_orders','purchase_orders','journal_entries','journal_lines',
  'transport_trips','transport_customer_documents','transport_supplier_documents',
  'invoice_payment_allocations','purchase_payment_allocations')
ORDER BY c.relname;
-- Grant on an RLS table is not proof of anonymous access: evaluate policy + auth conditions.

-- 2. Security-definer views. Flags are only a source review index;
-- assess joins/UNION branches in full, not just text-match booleans.
SELECT c.relname AS view_name,
       NOT EXISTS(SELECT 1 FROM unnest(coalesce(c.reloptions,'{}'::text[])) AS o
                  WHERE o = 'security_invoker=true') AS effective_security_definer,
       has_table_privilege('anon',c.oid,'SELECT') AS anon_select,
       has_table_privilege('authenticated',c.oid,'SELECT') AS authenticated_select,
       position('current_company_id' in pg_get_viewdef(c.oid,true)) > 0 AS mentions_company_scope,
       position('current_business_unit_id' in pg_get_viewdef(c.oid,true)) > 0 AS mentions_unit_scope,
       position('current_operating_location_id' in pg_get_viewdef(c.oid,true)) > 0 AS mentions_location_scope,
       position('has_module_permission' in pg_get_viewdef(c.oid,true)) > 0 AS mentions_permission_scope
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'v' AND c.relname IN
 ('transport_party_document_sources',
  'transport_driver_account_movements_before_salary_link',
  'transport_driver_month_trip_costs')
ORDER BY c.relname;

-- 3. Potentially exposed privileged functions. The short list may include
-- safe wrappers which DELEGATE to guarded functions; do not revoke blindly.
SELECT p.oid::regprocedure::text AS function_signature,
       has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
       position('auth.uid' in pg_get_functiondef(p.oid)) > 0 AS mentions_auth_uid,
       position('current_company_id' in pg_get_functiondef(p.oid)) > 0 AS mentions_current_company,
       position('has_module_permission' in pg_get_functiondef(p.oid)) > 0 AS mentions_permission_check,
       position('assert_module_permission' in pg_get_functiondef(p.oid)) > 0 AS mentions_assertion,
       position('transport_finance_assert' in pg_get_functiondef(p.oid)) > 0 AS mentions_finance_assertion
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prosecdef
  AND has_function_privilege('authenticated',p.oid,'EXECUTE')
  AND position('auth.uid' in pg_get_functiondef(p.oid))=0
  AND position('current_company_id' in pg_get_functiondef(p.oid))=0
  AND position('has_module_permission' in pg_get_functiondef(p.oid))=0
  AND position('is_platform_owner' in pg_get_functiondef(p.oid))=0
ORDER BY p.proname, p.oid::regprocedure::text;
-- For each returned function: review downstream calls, permissions, company scope,
-- row locks and lifecycle immutability; remediate only in approved migrations.

-- 4. Ownership invariants: ALL counts must be zero across all companies.
SELECT 'journal_lines_to_journals' AS relation, count(*) AS mismatches
 FROM public.journal_lines l JOIN public.journal_entries j ON j.id=l.entry_id
 WHERE l.company_id IS DISTINCT FROM j.company_id
UNION ALL SELECT 'journal_lines_to_accounts',count(*)
 FROM public.journal_lines l JOIN public.chart_of_accounts a ON a.id=l.account_id
 WHERE l.company_id IS DISTINCT FROM a.company_id
UNION ALL SELECT 'sales_to_customers',count(*)
 FROM public.sales_orders s JOIN public.customers c ON c.id=s.customer_id
 WHERE s.company_id IS DISTINCT FROM c.company_id
UNION ALL SELECT 'purchases_to_suppliers',count(*)
 FROM public.purchase_orders p JOIN public.suppliers s ON s.id=p.supplier_id
 WHERE p.company_id IS DISTINCT FROM s.company_id
UNION ALL SELECT 'customer_documents_to_sales',count(*)
 FROM public.transport_customer_documents d JOIN public.sales_orders s ON s.id=d.sales_order_id
 WHERE d.company_id IS DISTINCT FROM s.company_id
UNION ALL SELECT 'supplier_documents_to_purchases',count(*)
 FROM public.transport_supplier_documents d JOIN public.purchase_orders p ON p.id=d.purchase_order_id
 WHERE d.company_id IS DISTINCT FROM p.company_id
UNION ALL SELECT 'trips_to_vehicles',count(*)
 FROM public.transport_trips t JOIN public.transport_vehicles v ON v.id=t.vehicle_id
 WHERE t.company_id IS DISTINCT FROM v.company_id;

-- 5. Every posted journal should have meaningful lines, balance and a valid account.
WITH sums AS (
 SELECT j.id,j.company_id,
        count(l.id) AS lines,
        sum(coalesce(l.base_debit,l.debit,0)-coalesce(l.base_credit,l.credit,0)) AS delta,
        sum(coalesce(l.base_debit,l.debit,0)+coalesce(l.base_credit,l.credit,0)) AS movement
 FROM public.journal_entries j LEFT JOIN public.journal_lines l ON l.entry_id=j.id
 WHERE j.status='posted' GROUP BY j.id,j.company_id
)
SELECT c.name, count(s.id) FILTER (WHERE s.lines=0) AS no_lines,
       count(s.id) FILTER (WHERE abs(coalesce(s.delta,0))>0.01) AS unbalanced,
       count(s.id) FILTER (WHERE coalesce(s.movement,0)=0) AS zero_movement
FROM public.companies c LEFT JOIN sums s ON s.company_id=c.id
GROUP BY c.id,c.name ORDER BY c.name;

-- 6. New-company readiness: flag missing owner, location, business unit, and account map.
SELECT c.name,c.is_test_company,c.status,
 (SELECT count(*) FROM public.company_memberships x
  WHERE x.company_id=c.id AND x.role='company_owner' AND x.is_active) AS active_owners,
 (SELECT count(*) FROM public.business_units x
  WHERE x.company_id=c.id AND x.is_active) AS active_business_units,
 (SELECT count(*) FROM public.operating_locations x
  WHERE x.company_id=c.id AND x.is_active) AS active_locations,
 (SELECT count(*) FROM public.account_mappings x
  WHERE x.company_id=c.id) AS account_mappings
FROM public.companies c ORDER BY c.name;
