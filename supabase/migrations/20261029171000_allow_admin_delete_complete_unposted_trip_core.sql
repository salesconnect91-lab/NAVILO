-- Keep the low-level unposted trip delete guard consistent with the audited admin cascade.
-- This only removes the redundant requirement that the stored status literally be 'draft'.
-- Canonical status and every existing financial-document/dependency guard remain in force.

DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(
    'public.transport_delete_draft_trip(uuid,text)'::regprocedure
  ) INTO v_definition;

  v_old := $old$if t.status is distinct from 'draft'
 or public.transport_canonical_trip_status(t.id,false,false,0,0) not in ('draft','incomplete','complete')
 then raise exception 'Only an unposted Draft, Incomplete or Complete Trip without financial entries may be deleted'; end if;$old$;

  v_new := $new$if public.transport_canonical_trip_status(t.id,false,false,0,0) not in ('draft','incomplete','complete')
 then raise exception 'Only an unposted Draft, Incomplete or Complete Trip without financial entries may be deleted'; end if;$new$;

  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Expected unposted trip delete status guard was not found; migration stopped without changing the function.';
  END IF;

  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;
END
$migration$;
