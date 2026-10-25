-- Refresh supplier draft line descriptions from the current Trip Register.
-- Customer draft edits keep their existing line descriptions; supplier refresh
-- must reflect current job/reference, route, vehicle, and driver fields.
DO $supplier_refresh_description$
DECLARE
  v_definition text;
  v_old text := $old$v_description:=v_old_descriptions->>t.id::text;$old$;
  v_new text := $new$IF p_side='supplier' THEN
        v_description:=public.transport_trip_service_description(t.id)||' · Supplier rent';
      ELSE
        v_description:=v_old_descriptions->>t.id::text;
      END IF;$new$;
BEGIN
  SELECT pg_get_functiondef(
    'public.transport_edit_register_draft_invoice(text,uuid,uuid[],date,text,uuid)'::regprocedure
  ) INTO v_definition;

  IF length(v_definition)-length(replace(v_definition,v_old,'')) <> 2*length(v_old) THEN
    RAISE EXCEPTION 'Transport draft description logic changed; review this migration before applying';
  END IF;

  v_definition := replace(v_definition,v_old,v_new);
  EXECUTE v_definition;
END
$supplier_refresh_description$;
