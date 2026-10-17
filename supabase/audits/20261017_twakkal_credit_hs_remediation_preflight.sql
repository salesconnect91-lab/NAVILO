-- Credit-only historical H-S remediation preflight. READ ONLY.
-- Do not reverse, unpost, delete, or rename posted documents using this audit.
-- Twakkal Al Khaleej only; cash and supplier invoices excluded.
WITH candidate_invoices AS (
 SELECT DISTINCT so.id AS sales_order_id,so.order_no,so.company_id,so.business_unit_id,
        so.total,so.paid_amount,so.outstanding_amount,
        d.journal_entry_id
 FROM public.sales_orders so
 JOIN public.transport_customer_documents d ON d.sales_order_id=so.id
 JOIN public.transport_customer_document_trips l ON l.document_id=d.id AND NOT l.is_adjustment
 JOIN public.transport_trips t ON t.id=l.trip_id
 WHERE t.company_id='c611adca-fd2f-4cc1-b379-3aed22924f65'::uuid
   AND t.sale_type='credit'
   AND so.status='posted' AND so.order_no LIKE 'H-S-%'
   AND (NULLIF(btrim(t.source_invoice_no),'') IS NULL OR t.source_invoice_no !~ '[0-9]')
), audit AS (
 SELECT c.*,
        (SELECT count(*) FROM public.invoice_payment_allocations a WHERE a.sales_order_id=c.sales_order_id) AS allocation_rows,
        (SELECT coalesce(sum(a.amount),0) FROM public.invoice_payment_allocations a WHERE a.sales_order_id=c.sales_order_id) AS allocated_amount,
        (SELECT count(*) FROM public.journal_lines jl WHERE jl.entry_id=c.journal_entry_id) AS journal_lines,
        (SELECT coalesce(sum(jl.base_debit-jl.base_credit),0) FROM public.journal_lines jl WHERE jl.entry_id=c.journal_entry_id) AS journal_net,
        EXISTS(SELECT 1 FROM public.journal_entries rev WHERE rev.reversal_of_entry_id=c.journal_entry_id AND rev.status='posted') AS has_reversal,
        EXISTS(SELECT 1 FROM public.transport_service_note_lines n WHERE n.side='customer' AND n.order_id=c.sales_order_id) AS has_service_note
 FROM candidate_invoices c
)
SELECT sales_order_id,order_no,total,paid_amount,outstanding_amount,allocation_rows,allocated_amount,journal_entry_id,journal_lines,journal_net,has_reversal,has_service_note,
       CASE WHEN allocation_rows=0 AND coalesce(paid_amount,0)=0 AND journal_lines>0
                    AND abs(journal_net)<0.01 AND abs(total-paid_amount-outstanding_amount)<0.01
                    AND NOT has_reversal AND NOT has_service_note
            THEN 'UNPAID_CORRECTION_CANDIDATE'
            ELSE 'MANUAL_REVIEW_REQUIRED'
       END AS correction_lane
FROM audit ORDER BY correction_lane,order_no;
