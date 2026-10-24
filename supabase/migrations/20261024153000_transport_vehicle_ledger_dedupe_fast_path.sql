-- Avoid expanding the full contributions UNION view for every posted GL line.
-- This anti-join only tests the manual-contribution branch, so querying that
-- source directly is equivalent while avoiding repeated trip/invoice view plans.
DO $vehicle_ledger_dedupe_fast_path$
DECLARE
  definition text;
  updated text;
  old_source text := 'SELECT 1 FROM public.transport_vehicle_contributions already';
  new_source text := 'SELECT 1 FROM public.transport_vehicle_manual_contributions already';
BEGIN
  SELECT pg_get_functiondef(
    'public.transport_vehicle_ledger(uuid,date,date,integer,integer)'::regprocedure
  ) INTO definition;

  IF definition IS NULL THEN
    RAISE EXCEPTION 'Missing transport_vehicle_ledger RPC';
  END IF;

  IF length(definition) - length(replace(definition, old_source, '')) <> length(old_source) THEN
    RAISE EXCEPTION 'Expected one manual deduplication check in vehicle ledger RPC; refusing unsafe optimization';
  END IF;

  updated := replace(definition, old_source, new_source);
  IF updated = definition THEN
    RAISE EXCEPTION 'Vehicle ledger deduplication source did not change';
  END IF;

  EXECUTE updated;

  SELECT pg_get_functiondef(
    'public.transport_vehicle_ledger(uuid,date,date,integer,integer)'::regprocedure
  ) INTO definition;
  IF position(new_source IN definition) = 0
     OR position(old_source IN definition) > 0
     OR position('SECURITY DEFINER' IN definition) = 0
     OR position('SET search_path TO ''public'', ''pg_temp''' IN definition) = 0 THEN
    RAISE EXCEPTION 'Vehicle ledger RPC post-deployment verification failed';
  END IF;
END
$vehicle_ledger_dedupe_fast_path$;
