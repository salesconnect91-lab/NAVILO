-- NAVILO Transport Register — read-only customer/supplier financial acceptance.
-- Run in a production-safe READ ONLY transaction after each financial release.
-- Includes only canonical posted service documents; opening imports are separate.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout='60000';
WITH paid AS MATERIALIZED (
  SELECT 'customer'::text side,a.sales_order_id order_id,
         sum(a.amount) amount
  FROM public.invoice_payment_allocations a
  JOIN public.transport_active_journals j ON j.id=a.journal_entry_id
  GROUP BY a.sales_order_id
  UNION ALL
  SELECT 'supplier'::text side,a.purchase_order_id order_id,
         sum(a.amount) amount
  FROM public.purchase_payment_allocations a
  JOIN public.transport_active_journals j ON j.id=a.journal_entry_id
  GROUP BY a.purchase_order_id
), refunds AS MATERIALIZED (
  SELECT f.side,f.order_id,sum(f.amount) amount
  FROM public.transport_service_refunds f
  JOIN public.transport_active_journals j ON j.id=f.journal_entry_id
  GROUP BY f.side,f.order_id
), reconciled AS (
  SELECT b.side,b.order_id,b.paid_gross,b.refunded_gross,
         b.outstanding_gross,b.credit_gross,
         coalesce(p.amount,0) source_paid,
         coalesce(r.amount,0) source_refunded,
         greatest(round(b.original_gross-b.credited_gross-b.paid_gross+b.refunded_gross,2),0) due,
         greatest(round(b.paid_gross-b.refunded_gross-b.original_gross+b.credited_gross,2),0) credit
  FROM public.transport_service_document_balances_fast b
  LEFT JOIN paid p ON p.side=b.side AND p.order_id=b.order_id
  LEFT JOIN refunds r ON r.side=b.side AND r.order_id=b.order_id
)
SELECT side,count(*) posted_service_documents,
       count(*) FILTER (WHERE abs(paid_gross-source_paid)>0.005) payment_mismatches,
       count(*) FILTER (WHERE abs(refunded_gross-source_refunded)>0.005) refund_mismatches,
       count(*) FILTER (WHERE abs(outstanding_gross-due)>0.005) due_mismatches,
       count(*) FILTER (WHERE abs(credit_gross-credit)>0.005) credit_mismatches,
       CASE WHEN count(*) FILTER (
         WHERE abs(paid_gross-source_paid)>0.005
            OR abs(refunded_gross-source_refunded)>0.005
            OR abs(outstanding_gross-due)>0.005
            OR abs(credit_gross-credit)>0.005
       )=0 THEN 'PASS' ELSE 'FAIL' END result
FROM reconciled GROUP BY side ORDER BY side;
-- Exact parity between existing canonical balances and accelerated view.
SELECT count(*) AS financial_parity_mismatches FROM (
 (SELECT * FROM public.transport_service_document_balances
  EXCEPT ALL SELECT * FROM public.transport_service_document_balances_fast)
 UNION ALL
 (SELECT * FROM public.transport_service_document_balances_fast
  EXCEPT ALL SELECT * FROM public.transport_service_document_balances)
) diff;
ROLLBACK;
