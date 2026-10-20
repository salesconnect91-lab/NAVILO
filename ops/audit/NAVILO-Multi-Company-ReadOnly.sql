-- NAVILO repeatable read-only prelaunch audit; run with an authorized admin.
-- No INSERT, UPDATE, DELETE, DDL, COPY, or role impersonation.
-- This checks structural integrity; tenant-permission isolation still needs independent user-session tests.

-- All companies: readiness and financial volume.
SELECT c.name, c.status, c.is_test_company, c.base_currency_code,
       (SELECT count(*) FROM public.business_units b WHERE b.company_id = c.id AND b.is_active) AS business_units,
       (SELECT count(*) FROM public.operating_locations o WHERE o.company_id = c.id AND o.is_active) AS locations,
       (SELECT count(*) FROM public.journal_entries j WHERE j.company_id = c.id AND j.status = 'posted') AS posted_journals,
       (SELECT count(*) FROM public.sales_orders s WHERE s.company_id = c.id) AS sales_documents,
       (SELECT count(*) FROM public.purchase_orders p WHERE p.company_id = c.id) AS purchase_documents
FROM public.companies c ORDER BY c.name;

-- Every posted journal must balance, using company-scoped canonical amounts.
WITH totals AS (
 SELECT j.company_id,j.id,
        sum(coalesce(l.base_debit,l.debit,0) - coalesce(l.base_credit,l.credit,0)) AS difference
 FROM public.journal_entries j
 JOIN public.journal_lines l ON l.entry_id = j.id
 WHERE j.status = 'posted'
 GROUP BY j.company_id,j.id
)
SELECT c.name, count(t.id) FILTER (WHERE abs(t.difference) > 0.01) AS unbalanced_journals,
       coalesce(sum(abs(t.difference)) FILTER (WHERE abs(t.difference) > 0.01),0) AS absolute_difference
FROM public.companies c LEFT JOIN totals t ON t.company_id=c.id GROUP BY c.id,c.name ORDER BY c.name;

-- Cross-company joins: all counts must be zero. This does not replace RLS tests.
SELECT 'journal_lines -> journal_entries' AS relation, count(*) AS cross_company_rows
 FROM public.journal_lines l JOIN public.journal_entries e ON e.id=l.entry_id
 WHERE l.company_id IS DISTINCT FROM e.company_id
UNION ALL
SELECT 'journal_lines -> chart_of_accounts',count(*)
 FROM public.journal_lines l JOIN public.chart_of_accounts a ON a.id=l.account_id
 WHERE l.company_id IS DISTINCT FROM a.company_id
UNION ALL
SELECT 'sales -> customers',count(*)
 FROM public.sales_orders s JOIN public.customers c ON c.id=s.customer_id
 WHERE s.company_id IS DISTINCT FROM c.company_id
UNION ALL
SELECT 'purchases -> suppliers',count(*)
 FROM public.purchase_orders p JOIN public.suppliers s ON s.id=p.supplier_id
 WHERE p.company_id IS DISTINCT FROM s.company_id
UNION ALL
SELECT 'trips -> vehicles',count(*)
 FROM public.transport_trips t JOIN public.transport_vehicles v ON v.id=t.vehicle_id
 WHERE t.company_id IS DISTINCT FROM v.company_id;

-- Missing original invoice references are an investigation queue, NOT instructions to edit/repost data.
SELECT c.name, count(t.id) AS trips,
       count(t.id) FILTER (WHERE t.vehicle_id IS NULL) AS missing_vehicle_id,
       count(t.id) FILTER (WHERE nullif(btrim(t.source_invoice_no),'') IS NULL) AS missing_original_invoice
FROM public.companies c LEFT JOIN public.transport_trips t ON t.company_id=c.id
GROUP BY c.id,c.name ORDER BY c.name;
