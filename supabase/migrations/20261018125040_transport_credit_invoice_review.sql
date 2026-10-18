-- AUD-03: permission-scoped read-only review of generated-number Credit Trip invoices.
-- NO update/delete to posted Sales, journals, allocations, VAT or source Trips.
CREATE OR REPLACE FUNCTION public.transport_credit_invoice_review(
  p_lane text DEFAULT 'all', p_search text DEFAULT '', p_limit integer DEFAULT 100, p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $body$
DECLARE
  c uuid := public.current_company_id();
  b uuid := public.current_business_unit_id();
  loc uuid := public.current_operating_location_id();
  answer jsonb;
BEGIN
  IF auth.uid() IS NULL OR c IS NULL OR b IS NULL OR loc IS NULL
     OR NOT public.has_module_permission(c,'transport','view')
     OR NOT public.has_module_permission(c,'accounting','view')
     OR NOT public.transport_financial_read_allowed('customer')
  THEN
    RAISE EXCEPTION 'Transport customer financial report permission required' USING ERRCODE='42501';
  END IF;
  IF COALESCE(p_lane,'all') NOT IN ('all','UNPAID_CORRECTION_CANDIDATE','HAS_ORIGINAL_NUMBER','PAYMENT_LINKED_REVIEW','EXISTING_CORRECTION_REVIEW','ACCOUNTING_MISMATCH_REVIEW')
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset < 0
     OR length(COALESCE(p_search,'')) > 100
  THEN
    RAISE EXCEPTION 'Invalid Credit invoice review filter or page' USING ERRCODE='22023';
  END IF;

  WITH evidence AS MATERIALIZED (
    SELECT p.sales_order_id,p.invoice_no,s.order_date,
      p.trip_count,p.total,p.paid,p.outstanding,p.allocations,p.allocated,
      p.journal_lines,p.journal_net,p.review_lane,
      CASE WHEN source_refs.ref_count=1 THEN source_refs.ref_example ELSE NULL END AS source_reference_candidate,
      source_refs.ref_count AS distinct_source_references
    FROM public.transport_credit_hs_correction_preflight(c) p
    JOIN public.sales_orders s ON s.id=p.sales_order_id
      AND s.company_id=c AND s.business_unit_id=b AND s.operating_location_id=loc AND s.status='posted'
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT NULLIF(btrim(t.source_invoice_no),'')) FILTER (
        WHERE t.source_invoice_no ~ '[0-9]'
      ) AS ref_count,
      min(NULLIF(btrim(t.source_invoice_no),'')) FILTER (
        WHERE t.source_invoice_no ~ '[0-9]'
      ) AS ref_example
      FROM public.transport_customer_documents d
      JOIN public.transport_customer_document_trips l ON l.document_id=d.id AND l.is_adjustment=false
      JOIN public.transport_trips t ON t.id=l.trip_id AND t.company_id=c AND t.business_unit_id=b
      WHERE d.sales_order_id=s.id AND d.company_id=c AND d.business_unit_id=b
    ) source_refs ON true
  ), filtered AS MATERIALIZED (
    SELECT * FROM evidence e
    WHERE (COALESCE(p_lane,'all')='all' OR e.review_lane=p_lane)
      AND (
        COALESCE(btrim(p_search),'')=''
        OR e.invoice_no ILIKE ('%'||btrim(p_search)||'%')
        OR COALESCE(e.source_reference_candidate,'') ILIKE ('%'||btrim(p_search)||'%')
      )
  ), page AS (
    SELECT * FROM filtered ORDER BY order_date DESC,invoice_no,sales_order_id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT jsonb_build_object(
    'rows',(SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page.order_date DESC,page.invoice_no,page.sales_order_id),'[]'::jsonb) FROM page),
    'count',(SELECT count(*) FROM filtered),
    'gross',(SELECT COALESCE(sum(total),0) FROM filtered),
    'paid',(SELECT COALESCE(sum(paid),0) FROM filtered),
    'outstanding',(SELECT COALESCE(sum(outstanding),0) FROM filtered)
  ) INTO answer;
  RETURN answer;
END;
$body$;
REVOKE ALL ON FUNCTION public.transport_credit_invoice_review(text,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_credit_invoice_review(text,text,integer,integer) TO authenticated;
