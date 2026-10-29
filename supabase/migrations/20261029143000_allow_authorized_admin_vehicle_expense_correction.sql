-- Allow authorized company admins to correct/reverse posted Vehicle Expense documents.
-- Preserve source-document, workspace, reconciliation, duplicate-reversal, and audit guards.
-- This mirrors the already-applied production function change.
DO $migration$
DECLARE
  v_definition text;
  v_old text := 'IF NOT public.owner_posted_control_access() THEN';
  v_new text := 'IF NOT public.is_company_admin(c) THEN';
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'transport_vehicle_expense_reverse'
    AND pg_get_function_identity_arguments(p.oid) = 'p_id uuid, p_date date, p_reason text';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Expected Vehicle Expense reversal function not found';
  END IF;

  IF length(v_definition) - length(replace(v_definition, v_old, '')) <> length(v_old) THEN
    RAISE EXCEPTION 'Expected exactly one owner-only gate in Vehicle Expense reversal function';
  END IF;

  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;
END
$migration$;
