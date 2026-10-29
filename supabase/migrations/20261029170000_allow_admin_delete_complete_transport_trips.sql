-- Permit audited cascade deletion for Draft, Incomplete, and Complete trips.
-- Locked/Settled trips remain protected by canonical status validation.
-- Linked invoices, credit notes, payment dependencies, closed periods, branch scope,
-- explicit confirmation, delete permission, and immutable audit snapshots remain enforced.

DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(
    'public.transport_admin_delete_trip_cascade(uuid,text,text)'::regprocedure
  ) INTO v_definition;

  v_old := $old$IF t.status IS DISTINCT FROM 'draft'
     OR public.transport_canonical_trip_status(t.id,false,false,0,0) NOT IN ('draft','incomplete','complete') THEN$old$;

  v_new := $new$IF public.transport_canonical_trip_status(t.id,false,false,0,0) NOT IN ('draft','incomplete','complete') THEN$new$;

  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Expected transport trip delete status guard was not found; migration stopped without changing the function.';
  END IF;

  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;
END
$migration$;

COMMENT ON FUNCTION public.transport_admin_delete_trip_cascade(uuid,text,text) IS
  'Audited Owner/Admin trip cascade deletion. Draft, Incomplete, and Complete trips may be considered; Locked/Settled trips and trips with unsafe linked financial dependencies remain blocked.';
