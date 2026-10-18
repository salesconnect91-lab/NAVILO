-- NAVILO SEC-005: enforce callers' RLS on Transport Trip Register views.
-- Preserves columns and financial calculations.
ALTER VIEW public.transport_trip_register SET (security_invoker = true);
ALTER VIEW public.transport_trip_register_legacy_foundation SET (security_invoker = true);
