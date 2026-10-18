-- SEC006 phase B: revoke direct financial view access ONLY after production frontend is deployed.
-- PostgREST table/view access is no longer allowed for authenticated users.
-- Function owners and service_role retain their existing privileges.
REVOKE SELECT ON public.transport_financial_register FROM authenticated;
REVOKE SELECT ON public.transport_trip_financial_summary FROM authenticated;
