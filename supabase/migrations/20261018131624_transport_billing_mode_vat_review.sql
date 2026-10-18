-- AUD-03: Read-only review of recorded billing modes versus current master/Trip evidence.
-- Does not modify posted invoices, VAT, journals, payments, or masters.
CREATE OR REPLACE FUNCTION public.transport_billing_mode_vat_review(
  p_side text DEFAULT 'customer',
  p_kind text DEFAULT 'mismatch',
  p_search text DEFAULT '',
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $body$
DECLARE
  c uuid := public.current_company_id();
  b uuid := public.current_business_unit_id();
  loc uuid := public.current_operating_location_id();
  answer jsonb;
BEGIN
  IF p_side NOT IN ('customer','supplier') OR p_kind NOT IN ('mismatch','all')
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
     OR p_offset IS NULL OR p_offset < 0
     OR length(COALESCE(p_search,'')) > 100
  THEN RAISE EXCEPTION 'Invalid billing-mode review filters' USING ERRCODE='22023'; END IF;

  IF auth.uid() IS NULL OR c IS NULL OR b IS NULL OR loc IS NULL
     OR NOT public.has_module_permission(c,'transport','view')
     OR NOT public.has_module_permission(c,'accounting','view')
     OR NOT public.transport_financial_read_allowed(p_side)
  THEN RAISE EXCEPTION 'Transport financial report permission required' USING ERRCODE='42501'; END IF;

  WITH customer_evidence AS MATERIALIZED (
    SELECT s.id AS document_id,s.order_no AS invoice_no,s.order_date AS invoice_date,
      COALESCE(cu.name,s.customer_name_snapshot,'') AS party_name,
      COALESCE(s.payment_mode,'') AS posted_mode,
      COALESCE(cb.billing_mode,'') AS current_mode,
      COALESCE(string_agg(DISTINCT t.sale_type,', ' ORDER BY t.sale_type),'') AS trip_mode,
      COALESCE(sum(l.rate_snapshot),0)::numeric AS linked_net,
      COALESCE(sum(l.vat_snapshot),0)::numeric AS linked_vat,
      COALESCE(s.total,0)::numeric AS invoice_total,
      COALESCE(s.paid_amount,0)::numeric AS paid,
      COALESCE(s.outstanding_amount,0)::numeric AS outstanding,
      count(DISTINCT t.id) AS trip_count,
      COALESCE(s.tax_percent,0)::numeric AS tax_percent,
      bool_or(t.sale_type IS NOT NULL AND s.payment_mode IS NOT NULL
        AND lower(t.sale_type)<>lower(s.payment_mode)) AS mode_diff
    FROM public.transport_customer_documents d
    JOIN public.sales_orders s ON s.id=d.sales_order_id
      AND s.company_id=c AND s.business_unit_id=b AND s.operating_location_id=loc AND s.status='posted'
    JOIN public.journal_entries j ON j.id=d.journal_entry_id
      AND j.company_id=c AND j.business_unit_id=b AND j.status='posted'
    JOIN public.transport_customer_document_trips l ON l.document_id=d.id
      AND l.company_id=c AND l.business_unit_id=b AND l.operating_location_id=loc AND l.is_adjustment=false
    JOIN public.transport_trips t ON t.id=l.trip_id
      AND t.company_id=c AND t.business_unit_id=b AND t.operating_location_id=loc
    LEFT JOIN public.customers cu ON cu.id=d.customer_id AND cu.company_id=c
    LEFT JOIN public.transport_customer_billing_modes cb
      ON cb.company_id=c AND cb.business_unit_id=b AND cb.customer_id=d.customer_id
    WHERE p_side='customer' AND d.company_id=c AND d.business_unit_id=b AND d.operating_location_id=loc
    GROUP BY s.id,cu.name,cb.billing_mode
  ), supplier_evidence AS MATERIALIZED (
    SELECT po.id AS document_id,po.order_no AS invoice_no,po.order_date AS invoice_date,
      COALESCE(su.name,po.supplier_name_snapshot,'') AS party_name,
      COALESCE(po.transport_billing_mode,'') AS posted_mode,
      COALESCE(sb.billing_mode,'') AS current_mode,
      ''::text AS trip_mode,
      COALESCE(sum(l.amount_snapshot),0)::numeric AS linked_net,
      COALESCE(sum(l.vat_snapshot),0)::numeric AS linked_vat,
      COALESCE(po.total,0)::numeric AS invoice_total,
      COALESCE(po.paid_amount,0)::numeric AS paid,
      COALESCE(po.outstanding_amount,0)::numeric AS outstanding,
      count(DISTINCT l.trip_id) AS trip_count,
      COALESCE(po.tax_percent,0)::numeric AS tax_percent,
      bool_or(sb.billing_mode IS NOT NULL AND po.transport_billing_mode IS NOT NULL
        AND lower(sb.billing_mode)<>lower(po.transport_billing_mode)) AS mode_diff
    FROM public.transport_supplier_documents d
    JOIN public.purchase_orders po ON po.id=d.purchase_order_id
      AND po.company_id=c AND po.business_unit_id=b AND po.operating_location_id=loc AND po.status='posted'
    JOIN public.journal_entries j ON j.id=d.journal_entry_id
      AND j.company_id=c AND j.business_unit_id=b AND j.status='posted'
    JOIN public.transport_supplier_document_rents l ON l.document_id=d.id
      AND l.company_id=c AND l.business_unit_id=b AND l.operating_location_id=loc AND l.is_adjustment=false
    LEFT JOIN public.suppliers su ON su.id=d.supplier_id AND su.company_id=c
    LEFT JOIN public.transport_supplier_billing_modes sb
      ON sb.company_id=c AND sb.business_unit_id=b AND sb.supplier_id=d.supplier_id
    WHERE p_side='supplier' AND d.company_id=c AND d.business_unit_id=b AND d.operating_location_id=loc
    GROUP BY po.id,su.name,sb.billing_mode
  ), evidence AS MATERIALIZED (
    SELECT * FROM customer_evidence UNION ALL SELECT * FROM supplier_evidence
  ), filtered AS MATERIALIZED (
    SELECT e.* FROM evidence e
    WHERE (p_kind='all' OR e.mode_diff)
      AND (COALESCE(btrim(p_search),'')='' OR
           e.invoice_no ILIKE ('%'||btrim(p_search)||'%') OR
           e.party_name ILIKE ('%'||btrim(p_search)||'%'))
  ), page AS (
    SELECT * FROM filtered ORDER BY invoice_date DESC,invoice_no,document_id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT jsonb_build_object(
    'rows',(SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page.invoice_date DESC,page.invoice_no,page.document_id),'[]'::jsonb) FROM page),
    'count',(SELECT count(*) FROM filtered),
    'linked_net',(SELECT COALESCE(sum(linked_net),0) FROM filtered),
    'linked_vat',(SELECT COALESCE(sum(linked_vat),0) FROM filtered),
    'invoice_total',(SELECT COALESCE(sum(invoice_total),0) FROM filtered)
  ) INTO answer;
  RETURN answer;
END;
$body$;
REVOKE ALL ON FUNCTION public.transport_billing_mode_vat_review(text,text,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_billing_mode_vat_review(text,text,text,integer,integer) TO authenticated;
