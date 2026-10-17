-- Multiple company vehicles may share an existing Revenue COA. Vehicle identity
-- stays on sales_service_lines.transport_vehicle_id so Vehicle P&L stays separate.
-- This removes only the per-vehicle mapping uniqueness constraint; it does not
-- change historical invoice/journal records or create Chart of Accounts records.
BEGIN;
DROP INDEX IF EXISTS public.transport_vehicle_income_coa_one_to_one;
COMMIT;
