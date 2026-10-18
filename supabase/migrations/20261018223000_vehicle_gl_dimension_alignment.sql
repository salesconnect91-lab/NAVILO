-- NAVILO vehicle accounting: keep user-selected GL, retain ownership validation.
-- Forward-only, fail-closed. No financial data migration.
DO $navilo$
DECLARE f text; a integer; b integer;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO f FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='transport_normal_invoice_create';
 IF md5(f) IS DISTINCT FROM '03f8f3263d5592c90f20de4a501d6088'
 THEN RAISE EXCEPTION 'Normal invoice definition drift; migration refused'; END IF;
 a:=strpos(f,'    IF selected_vehicle IS NOT NULL THEN');
 b:=strpos(f,'    INSERT INTO public.sales_service_lines');
 IF a=0 OR b<=a OR position('v.revenue_account_id' in substring(f from a for b-a))=0
 THEN RAISE EXCEPTION 'Normal invoice patch anchors missing'; END IF;
 EXECUTE left(f,a-1) || $replacement$
    IF selected_vehicle IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.transport_vehicles v
      JOIN public.transport_vehicle_ownership o ON o.vehicle_id=v.id
       AND o.company_id=v.company_id AND o.business_unit_id=v.business_unit_id
      WHERE v.id=selected_vehicle AND v.company_id=c AND v.business_unit_id=b
       AND v.is_active AND o.owner_type='company'
       AND o.effective_from<=p_date AND (o.effective_to IS NULL OR o.effective_to>=p_date)
    ) THEN RAISE EXCEPTION 'Select a company-owned Vehicle valid on invoice date'; END IF;
$replacement$ || substring(f from b);

 SELECT pg_get_functiondef(p.oid) INTO f FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='transport_trip_customer_income_account';
 IF md5(f) IS DISTINCT FROM 'a8d006d09f92d0d9646db24c8e8d934a'
 THEN RAISE EXCEPTION 'Trip service definition drift; migration refused'; END IF;
 a:=strpos(f,chr(10)||' IF v_owner=''company'' THEN');
 b:=strpos(f,chr(10)||' RETURN p_service_revenue_account;');
 IF a=0 OR b<=a OR position('v.revenue_account_id' in substring(f from a for b-a))=0
 THEN RAISE EXCEPTION 'Trip Service patch anchors missing'; END IF;
 EXECUTE left(f,a-1) || $trip$
 IF v_owner='company' THEN
   RETURN p_service_revenue_account;
 END IF;$trip$ || substring(f from b);
END
$navilo$;
