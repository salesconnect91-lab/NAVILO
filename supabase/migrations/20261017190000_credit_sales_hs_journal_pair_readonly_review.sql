CREATE OR REPLACE FUNCTION public.transport_credit_hs_journal_pair_review(p_company_id uuid)
RETURNS TABLE(sales_order_id uuid, sales_journal_id uuid, opening_journal_id uuid, invoice_total numeric, sales_debit numeric, sales_credit numeric, opening_debit numeric, opening_credit numeric, pair_ar_net numeric, verdict text)
LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
WITH invoices AS (
 SELECT p.sales_order_id,p.total, d.journal_entry_id sale_journal,
        o.document_id opening_doc
 FROM public.transport_credit_hs_correction_preflight(p_company_id) p
 JOIN public.transport_customer_documents d ON d.sales_order_id=p.sales_order_id
 JOIN public.transport_customer_document_trips l ON l.document_id=d.id AND NOT l.is_adjustment
 JOIN public.transport_trips t ON t.id=l.trip_id AND t.company_id=p_company_id AND t.sale_type='credit'
 JOIN public.transport_opening_invoice_lines o ON o.trip_id=t.id AND o.side='customer'
 WHERE p.review_lane='UNPAID_CORRECTION_CANDIDATE'
), pairs AS (
 SELECT i.*,j.id opening_journal
 FROM invoices i JOIN public.journal_entries j ON j.source_document_id=i.opening_doc
 AND j.status='posted' AND j.company_id=p_company_id
), amounts AS (
 SELECT p.*,
 (SELECT coalesce(sum(l.base_debit),0) FROM public.journal_lines l WHERE l.entry_id=p.sale_journal) sd,
 (SELECT coalesce(sum(l.base_credit),0) FROM public.journal_lines l WHERE l.entry_id=p.sale_journal) sc,
 (SELECT coalesce(sum(l.base_debit),0) FROM public.journal_lines l WHERE l.entry_id=p.opening_journal) od,
 (SELECT coalesce(sum(l.base_credit),0) FROM public.journal_lines l WHERE l.entry_id=p.opening_journal) oc,
 (SELECT coalesce(sum(l.base_debit-l.base_credit),0) FROM public.journal_lines l JOIN public.chart_of_accounts a ON a.id=l.account_id WHERE l.entry_id IN (p.sale_journal,p.opening_journal) AND a.name='Accounts Receivable') arn
 FROM pairs p
)
SELECT sales_order_id,sale_journal,opening_journal,total,sd,sc,od,oc,arn,
CASE WHEN sale_journal=opening_journal OR abs(sd-sc)>0.01 OR abs(od-oc)>0.01 OR abs(arn)>0.01
  OR abs(sd-total)>0.01 OR abs(od-total)>0.01
  THEN 'MANUAL_REVIEW' ELSE 'BALANCED_PAIR_REVIEWED' END
FROM amounts
$fn$;
REVOKE ALL ON FUNCTION public.transport_credit_hs_journal_pair_review(uuid) FROM PUBLIC,anon,authenticated;