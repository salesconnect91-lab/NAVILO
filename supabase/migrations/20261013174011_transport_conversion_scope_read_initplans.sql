begin;
alter policy transport_register_invoice_conversions_read on public.transport_register_invoice_conversions using(
 company_id=(select public.current_company_id()) and business_unit_id=(select public.current_business_unit_id()) and operating_location_id=(select public.current_operating_location_id())
 and ((side='customer' and (select public.transport_financial_read_allowed('customer'))) or (side='supplier' and (select public.transport_financial_read_allowed('supplier')))));
alter policy transport_register_conversion_sources_read on public.transport_register_conversion_sources using(
 company_id=(select public.current_company_id()) and business_unit_id=(select public.current_business_unit_id()) and operating_location_id=(select public.current_operating_location_id())
 and (select public.has_module_permission(public.current_company_id(),'accounting','view')));
alter policy transport_register_conversion_dates_read on public.transport_register_conversion_dates using(
 company_id=(select public.current_company_id()) and business_unit_id=(select public.current_business_unit_id()) and operating_location_id=(select public.current_operating_location_id())
 and (select public.has_module_permission(public.current_company_id(),'accounting','view')));
commit;