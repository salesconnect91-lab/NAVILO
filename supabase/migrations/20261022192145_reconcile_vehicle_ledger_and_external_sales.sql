BEGIN;

-- External invoices are normal, vehicle-attributed sales. Only trip-linked
-- invoices use the mapped Service Revenue account.
DO $external_sales_mapping$
DECLARE
  definition text;
  updated text;
BEGIN
  SELECT pg_get_functiondef(
    'public.transport_import_external_invoices(text,uuid,jsonb)'::regprocedure
  ) INTO definition;
  IF definition IS NULL THEN
    RAISE EXCEPTION 'Missing external transport invoice import RPC';
  END IF;
  updated:=replace(
    definition,
    'am.mapping_key=''service_revenue''',
    'am.mapping_key=''sales_revenue'''
  );
  updated:=replace(
    updated,
    'mapped Service Revenue account',
    'mapped Sales Revenue account'
  );
  IF updated=definition THEN
    RAISE EXCEPTION 'External invoice account validation changed; refusing unsafe update';
  END IF;
  EXECUTE updated;
END
$external_sales_mapping$;

-- A linked vehicle COA is one vehicle ledger and accepts both income credits
-- and expense debits. The P&L will net its movement into that same vehicle.
DROP TRIGGER IF EXISTS guard_transport_vehicle_income_debit ON public.journal_lines;
DROP FUNCTION IF EXISTS public.guard_transport_vehicle_income_debit();

COMMIT;
