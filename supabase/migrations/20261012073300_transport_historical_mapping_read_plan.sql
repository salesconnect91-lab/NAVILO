-- Same scope, branch and financial permissions; evaluate row-independent checks once.
-- Source mapping now contains 16,732 rows; per-row permission calls exceeded the
-- production Register's 8-second read budget. No access is widened.
alter policy historical_operational_read on public.transport_historical_operational_mapping using (
 company_id=(select public.current_company_id())
 and business_unit_id=(select public.current_business_unit_id())
 and operating_location_id=(select public.current_operating_location_id())
 and (select public.has_module_permission(public.current_company_id(),'transport','view'))
 and (select public.transport_financial_read_allowed('customer'))
 and (select public.transport_financial_read_allowed('supplier'))
);
alter policy transport_historical_identity_read on public.transport_historical_trip_identity using (
 (select auth.uid()) is not null
 and company_id=(select public.current_company_id())
 and business_unit_id=(select public.current_business_unit_id())
 and operating_location_id=(select public.current_operating_location_id())
 and (select public.has_module_permission(public.current_company_id(),'transport','view'))
 and (select public.transport_financial_read_allowed('customer'))
 and (select public.transport_financial_read_allowed('supplier'))
);
