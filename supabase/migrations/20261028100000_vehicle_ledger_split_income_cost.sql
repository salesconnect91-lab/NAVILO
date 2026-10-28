BEGIN;

-- A dedicated vehicle COA is the vehicle's single ledger. Classify its posted
-- debit movement as vehicle cost and its credit movement as vehicle income,
-- regardless of the COA's legacy type. This keeps old vehicle accounts usable
-- without creating separate GL accounts for fuel, repairs, tyres, etc.
DO $vehicle_ledger_split_income_cost$
DECLARE
  definition text;
  updated text;
  old_revenue text := '(CASE WHEN a.type IN (''revenue'',''income'') THEN l.credit-l.debit ELSE 0 END)::numeric AS revenue,';
  old_cost text := '(CASE WHEN a.type=''expense'' THEN l.debit-l.credit ELSE 0 END)::numeric AS cost';
  new_revenue text := 'l.credit::numeric AS revenue,';
  new_cost text := 'l.debit::numeric AS cost';
BEGIN
  SELECT pg_get_functiondef(
    'public.transport_vehicle_ledger(uuid,date,date,integer,integer)'::regprocedure
  ) INTO definition;

  IF definition IS NULL THEN
    RAISE EXCEPTION 'Missing transport_vehicle_ledger RPC; refusing vehicle accounting change';
  END IF;

  IF length(definition)-length(replace(definition,old_revenue,'')) <> length(old_revenue)
     OR length(definition)-length(replace(definition,old_cost,'')) <> length(old_cost) THEN
    RAISE EXCEPTION 'Vehicle ledger classification differs from expected source; refusing unsafe update';
  END IF;

  updated := replace(definition,old_revenue,new_revenue);
  updated := replace(updated,old_cost,new_cost);

  IF updated=definition THEN
    RAISE EXCEPTION 'Vehicle ledger classification was not changed';
  END IF;

  EXECUTE updated;

  SELECT pg_get_functiondef(
    'public.transport_vehicle_ledger(uuid,date,date,integer,integer)'::regprocedure
  ) INTO definition;

  IF position(new_revenue IN definition)=0
     OR position(new_cost IN definition)=0
     OR position(old_revenue IN definition)>0
     OR position(old_cost IN definition)>0 THEN
    RAISE EXCEPTION 'Vehicle ledger income/cost split verification failed';
  END IF;
END
$vehicle_ledger_split_income_cost$;

COMMIT;
