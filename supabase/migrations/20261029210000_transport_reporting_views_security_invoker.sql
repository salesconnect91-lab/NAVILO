-- Make transport reporting views obey the querying user's table privileges and RLS.
-- Their definitions already scope rows to the active company, business unit, location,
-- and transport module permission; security_invoker additionally applies underlying RLS.
BEGIN;

ALTER VIEW public.transport_party_document_sources SET (security_invoker = true);
ALTER VIEW public.transport_driver_account_movements_before_salary_link SET (security_invoker = true);
ALTER VIEW public.transport_driver_month_trip_costs SET (security_invoker = true);

COMMIT;
