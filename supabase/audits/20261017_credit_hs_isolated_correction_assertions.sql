-- NAVILO / Twakkal: controlled Credit H-S correction TEST ASSERTIONS.
-- Run against an isolated restored database BEFORE authorizing a correction.
-- This is READ ONLY; it never changes financial evidence.
-- Expected baseline: 159 unpaid and 23 payment-linked affected invoices.
WITH preflight AS (
  SELECT * FROM public.transport_credit_hs_correction_preflight('c611adca-fd2f-4cc1-b379-3aed22924f65'::uuid)
), paired AS (
  SELECT * FROM public.transport_credit_hs_journal_pair_review('c611adca-fd2f-4cc1-b379-3aed22924f65'::uuid)
), failures AS (
 SELECT p.sales_order_id,
        CASE WHEN p.allocation_count <> 0 THEN 'ALLOCATION_PRESENT'
             WHEN p.paid <> 0 THEN 'PAYMENT_PRESENT'
             WHEN p.journal_lines < 2 THEN 'MISSING_JOURNAL_LINES'
             WHEN abs(p.journal_net) > 0.01 THEN 'JOURNAL_UNBALANCED'
             WHEN abs(p.total - p.outstanding) > 0.01 THEN 'AMOUNT_MISMATCH'
             WHEN j.verdict IS DISTINCT FROM 'BALANCED_PAIR_REVIEWED' THEN 'JOURNAL_PAIR_UNVERIFIED'
             ELSE NULL END AS failure
 FROM preflight p LEFT JOIN paired j ON j.sales_order_id=p.sales_order_id
 WHERE p.review_lane='UNPAID_CORRECTION_CANDIDATE'
)
SELECT 'UNPAID_CANDIDATES' AS check_name, count(*)::numeric AS value FROM preflight WHERE review_lane='UNPAID_CORRECTION_CANDIDATE'
UNION ALL SELECT 'PAYMENT_LINKED_REVIEW',count(*) FROM preflight WHERE review_lane='PAYMENT_LINKED_REVIEW'
UNION ALL SELECT 'ORIGINAL_NUMBER_CASES',count(*) FROM preflight WHERE review_lane='HAS_ORIGINAL_NUMBER'
UNION ALL SELECT 'BLOCKING_FAILURES',count(*) FROM failures WHERE failure IS NOT NULL
UNION ALL SELECT 'TOTAL_UNPAID_AMOUNT',coalesce(sum(total),0) FROM preflight WHERE review_lane='UNPAID_CORRECTION_CANDIDATE';
-- DO NOT process any candidate if BLOCKING_FAILURES <> 0.
-- Actual correction requires an isolated-tested, atomic reversal of original
-- Sales AND opening reclassification journals, preservation of historical
-- evidence, and a separately authorized billing re-eligibility representation.
-- Never delete immutable document-trip links or directly set posted invoices to draft.
