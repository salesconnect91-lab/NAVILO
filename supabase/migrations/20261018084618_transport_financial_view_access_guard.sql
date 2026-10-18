-- SEC-006: remove direct PostgREST read access to privileged financial views.
-- Existing view SQL and accounting formulas are intentionally unchanged.
-- Security-definer RPCs that filter company/BU/location remain functional.
-- The Trip Finance popup uses this scoped endpoint instead of direct view SELECT.

CREATE OR REPLACE FUNCTION public.transport_financial_register_trip(p_trip_id uuid)
RETURNS SETOF public.transport_financial_register
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c uuid := public.current_company_id();
  b uuid := public.current_business_unit_id();
  loc uuid := public.current_operating_location_id();
BEGIN
  IF auth.uid() IS NULL OR p_trip_id IS NULL OR c IS NULL OR b IS NULL OR loc IS NULL THEN
    RAISE EXCEPTION 'Authenticated Transport scope required' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_module_permission(c, 'transport', 'view')
     OR NOT public.transport_financial_read_allowed('customer')
     OR NOT public.transport_financial_read_allowed('supplier') THEN
    RAISE EXCEPTION 'Transport financial viewing permission required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT r.*
  FROM public.transport_financial_register AS r
  JOIN public.transport_trips AS t ON t.id = r.id
      AND t.company_id = r.company_id AND t.business_unit_id = r.business_unit_id
  WHERE r.id = p_trip_id
    AND r.company_id = c
    AND r.business_unit_id = b
    AND t.operating_location_id = loc
  LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.transport_financial_register_trip(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transport_financial_register_trip(uuid) TO authenticated;

-- SEC006 phase A only: new secure RPC, preserve old direct reads during frontend rollout.
