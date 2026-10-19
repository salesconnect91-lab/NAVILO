-- Dashboard expense mix: posted GL only. VAT control accounts are excluded by COA type.
-- No mutations, no generated bills, no duplication of Sales/Purchase reports.
CREATE OR REPLACE FUNCTION public.dashboard_expense_breakdown(p_month date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $body$
DECLARE
  c uuid := public.current_company_id();
  b uuid := public.current_business_unit_id();
  loc uuid := public.current_operating_location_id();
  month_start date := date_trunc('month',coalesce(p_month,current_date))::date;
  prev_start date;
  next_start date;
  v_currency text;
  v_total numeric := 0;
  v_previous numeric := 0;
  v_categories jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR c IS NULL
     OR NOT public.has_module_permission(c,'dashboard','view')
     OR NOT public.has_module_permission(c,'accounting','view')
  THEN RAISE EXCEPTION 'Accounting Dashboard view permission required'; END IF;

  prev_start := (month_start - INTERVAL '1 month')::date;
  next_start := (month_start + INTERVAL '1 month')::date;
  SELECT coalesce(base_currency_code,'SAR') INTO v_currency
    FROM public.companies WHERE id=c;

  WITH by_account AS MATERIALIZED (
    SELECT a.id, a.name, a.detail_type,
      sum(CASE WHEN j.entry_date>=month_start
        THEN coalesce(l.base_debit,l.debit,0)-coalesce(l.base_credit,l.credit,0)
        ELSE 0 END)::numeric AS amount,
      sum(CASE WHEN j.entry_date<month_start
        THEN coalesce(l.base_debit,l.debit,0)-coalesce(l.base_credit,l.credit,0)
        ELSE 0 END)::numeric AS previous
    FROM public.journal_entries j
    JOIN public.journal_lines l ON l.entry_id=j.id
      AND l.company_id=c
      AND (b IS NULL OR l.business_unit_id=b)
      AND (loc IS NULL OR l.operating_location_id=loc)
    JOIN public.chart_of_accounts a ON a.id=l.account_id
      AND a.company_id=c AND a.type='expense' AND NOT a.is_group
    WHERE j.company_id=c AND j.status='posted'
      AND j.entry_date>=prev_start AND j.entry_date<next_start
      AND (b IS NULL OR j.business_unit_id=b)
      AND (loc IS NULL OR j.operating_location_id=loc)
    GROUP BY a.id,a.name,a.detail_type
  )
  SELECT coalesce(sum(amount),0),coalesce(sum(previous),0),
    coalesce(jsonb_agg(jsonb_build_object(
      'name',name,'detail_type',detail_type,'amount',round(amount,2),
      'previous_amount',round(previous,2)
    ) ORDER BY amount DESC,name) FILTER (WHERE amount<>0 OR previous<>0),'[]'::jsonb)
  INTO v_total,v_previous,v_categories FROM by_account;

  RETURN jsonb_build_object(
    'month',month_start,'currency',v_currency,
    'total',round(v_total,2),'previous_total',round(v_previous,2),
    'categories',v_categories,
    'basis','posted_expense_gl_excluding_vat_control'
  );
END
$body$;

REVOKE ALL ON FUNCTION public.dashboard_expense_breakdown(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dashboard_expense_breakdown(date) FROM anon;
GRANT EXECUTE ON FUNCTION public.dashboard_expense_breakdown(date) TO authenticated;
