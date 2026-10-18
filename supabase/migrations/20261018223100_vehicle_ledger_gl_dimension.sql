-- NAVILO posted Vehicle Ledger: include vehicle-tagged GL journals exactly once.
-- Existing trip/normal invoice contribution projections are unchanged.
DO $navilo$
DECLARE f text;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO f FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='transport_vehicle_ledger';
 IF md5(f) IS DISTINCT FROM 'fc734aa94f1f3c0c8c14094c1fa35ebb'
 THEN RAISE EXCEPTION 'Vehicle Ledger function drift; migration refused'; END IF;
 IF length(f)-length(replace(f,'), page as (','')) <> length('), page as (')
 THEN RAISE EXCEPTION 'Vehicle Ledger query anchor missing or ambiguous'; END IF;
 EXECUTE replace(f,'), page as (',$join$
 UNION ALL
 SELECT ('vehicle-gl:'||l.id::text)::text AS event_id,
   j.company_id,j.business_unit_id,j.operating_location_id,
   NULL::uuid AS trip_id,''::text AS trip_no,
   l.transport_vehicle_id AS account_id,v.vehicle_no AS account_name,
   j.entry_date AS event_date,j.entry_no,
   (CASE WHEN j.reversal_of_entry_id IS NOT NULL THEN 'reversal_journal'
     WHEN j.source_document_type='transport_vehicle_expense' THEN 'vehicle_expense'
     ELSE 'journal_adjustment' END)::text AS event_type,
   'Posted Journal'::text AS category,a.name::text AS expense_accounts,
   (CASE WHEN a.type IN ('revenue','income') THEN l.credit-l.debit ELSE 0 END)::numeric AS revenue,
   (CASE WHEN a.type='expense' THEN l.debit-l.credit ELSE 0 END)::numeric AS cost
 FROM public.journal_lines l
 JOIN public.journal_entries j ON j.id=l.entry_id AND j.company_id=l.company_id
   AND j.business_unit_id=l.business_unit_id AND j.status='posted'
 JOIN public.transport_vehicles v ON v.id=l.transport_vehicle_id
   AND v.company_id=j.company_id AND v.business_unit_id=j.business_unit_id
 JOIN public.chart_of_accounts a ON a.id=l.account_id AND a.company_id=l.company_id
   AND a.type IN ('revenue','income','expense')
 WHERE l.company_id=c AND l.business_unit_id=b AND l.operating_location_id=loc
   AND l.transport_vehicle_id=p_vehicle AND j.operating_location_id=loc
   AND (p_from IS NULL OR j.entry_date>=p_from)
   AND (p_to IS NULL OR j.entry_date<=p_to)
   AND coalesce(j.source_module,'') IN ('','accounting')
   AND coalesce(j.source_document_type,'') <> 'cutover_opening_balances'
   AND j.fiscal_year_closure_id IS NULL AND j.monthly_profit_closure_id IS NULL
   AND coalesce(j.trans_type,'') IN ('','Journal Entry','Manual Journal','Journal Reversal')
), page as ($join$);
END
$navilo$;
