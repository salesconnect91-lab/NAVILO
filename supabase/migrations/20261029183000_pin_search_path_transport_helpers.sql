-- Pin search_path on the remaining functions flagged by the Supabase security advisor.
-- Keep public objects resolvable while preventing caller-controlled schema shadowing.
ALTER FUNCTION public.transport_historical_billing_immutable()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.transport_historical_operational_immutable()
  SET search_path = public, pg_temp;
ALTER FUNCTION public._transport_linked_register_source(uuid, uuid, uuid)
  SET search_path = public, pg_temp;
ALTER FUNCTION public._transport_service_balances_for_orders(uuid[], uuid[])
  SET search_path = public, pg_temp;
