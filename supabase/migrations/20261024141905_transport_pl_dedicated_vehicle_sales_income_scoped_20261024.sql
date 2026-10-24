-- Classify normal Sales Invoice revenue credited to dedicated vehicle GLs as Sales Income.
-- Read-only aggregation over posted ledger rows; no journal or account changes.
CREATE OR REPLACE FUNCTION public.transport_pl_dedicated_vehicle_sales_income_scoped(
  p_from date,
  p_to date,
  p_scope text DEFAULT 'branch'
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  c uuid := public.current_company_id();
  b uuid := public.current_business_unit_id();
  loc uuid := public.current_operating_location_id();
  result_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR c IS NULL
     OR NOT public.has_module_permission(c,'accounting','view')
     OR NOT public.has_module_permission(c,'sales','view') THEN
    RAISE EXCEPTION 'Accounting and Sales view permissions required';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from>p_to THEN
    RAISE EXCEPTION 'Valid P&L date range required';
  END IF;
  IF p_scope NOT IN ('branch','business_unit','company') THEN
    RAISE EXCEPTION 'Invalid P&L scope';
  END IF;
  IF (p_scope IN ('branch','business_unit') AND b IS NULL)
     OR (p_scope='branch' AND loc IS NULL) THEN
    RAISE EXCEPTION 'Active business unit and branch required';
  END IF;
  IF p_scope<>'company' AND NOT EXISTS (
    SELECT 1 FROM public.business_units u
    WHERE u.id=b AND u.company_id=c AND u.unit_type='transport' AND u.is_active
  ) THEN
    RAISE EXCEPTION 'Transport business unit required';
  END IF;

  WITH vehicle_accounts AS (
    SELECT v.revenue_account_id AS account_id
    FROM public.transport_vehicles v
    JOIN public.chart_of_accounts a
      ON a.id=v.revenue_account_id AND a.company_id=v.company_id
    WHERE v.company_id=c
      AND v.ownership_type='company'
      AND v.is_active
      AND a.is_active
      AND NOT a.is_group
      AND a.type IN ('revenue','income')
      AND a.code NOT IN ('4100','4200')
      AND (p_scope='company' OR v.business_unit_id=b)
    GROUP BY v.revenue_account_id
    HAVING count(DISTINCT v.id)=1
  ),
  source_journals AS (
    SELECT j.id,j.company_id,j.business_unit_id,j.operating_location_id
    FROM public.journal_entries j
    WHERE j.company_id=c
      AND j.status='posted'
      AND j.source_module='sales'
      AND j.source_document_type='sales_invoice'
      AND j.entry_date BETWEEN p_from AND p_to
      AND (p_scope='company' OR j.business_unit_id=b)
      AND (p_scope<>'branch' OR j.operating_location_id=loc)
    UNION
    SELECT r.id,r.company_id,r.business_unit_id,r.operating_location_id
    FROM public.journal_entries r
    JOIN public.journal_entries original ON original.id=r.reversal_of_entry_id
    LEFT JOIN public.journal_entries root ON root.id=original.reversal_of_entry_id
    WHERE r.company_id=c
      AND r.status='posted'
      AND r.entry_date BETWEEN p_from AND p_to
      AND (p_scope='company' OR r.business_unit_id=b)
      AND (p_scope<>'branch' OR r.operating_location_id=loc)
      AND (
        (original.source_module='sales' AND original.source_document_type='sales_invoice')
        OR (root.source_module='sales' AND root.source_document_type='sales_invoice')
      )
  ),
  totals AS (
    SELECT l.account_id,round(sum(l.credit-l.debit),2) AS amount
    FROM source_journals s
    JOIN public.ledgers l
      ON l.journal_entry_id=s.id
     AND l.company_id=s.company_id
     AND l.business_unit_id=s.business_unit_id
     AND l.operating_location_id IS NOT DISTINCT FROM s.operating_location_id
    JOIN vehicle_accounts va ON va.account_id=l.account_id
    WHERE l.entry_date BETWEEN p_from AND p_to
    GROUP BY l.account_id
  )
  SELECT coalesce(
    jsonb_agg(jsonb_build_object('account_id',t.account_id,'amount',t.amount) ORDER BY t.account_id),
    '[]'::jsonb
  ) INTO result_rows
  FROM totals t;

  RETURN jsonb_build_object('rows',result_rows);
END
$function$;

REVOKE ALL ON FUNCTION public.transport_pl_dedicated_vehicle_sales_income_scoped(date,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transport_pl_dedicated_vehicle_sales_income_scoped(date,date,text) TO authenticated;
COMMENT ON FUNCTION public.transport_pl_dedicated_vehicle_sales_income_scoped(date,date,text) IS
  'Read-only Sales Income classification for posted normal Sales Invoice ledger movements credited to dedicated company vehicle GLs, scoped to the active company/unit/location.';

NOTIFY pgrst,'reload schema';
