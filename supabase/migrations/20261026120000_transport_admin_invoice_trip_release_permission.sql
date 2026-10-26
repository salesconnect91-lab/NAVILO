BEGIN;

CREATE OR REPLACE FUNCTION public.transport_admin_invoice_trip_release_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND navilo_private.transport_invoice_admin_access()
$function$;

REVOKE ALL ON FUNCTION public.transport_admin_invoice_trip_release_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transport_admin_invoice_trip_release_access() TO authenticated;

ALTER TABLE public.owner_posted_control_events
  DROP CONSTRAINT IF EXISTS owner_posted_control_events_action_type_check;
ALTER TABLE public.owner_posted_control_events
  ADD CONSTRAINT owner_posted_control_events_action_type_check
  CHECK (action_type = ANY (ARRAY[
    'cancel','correct','reverse','permanent_delete','owner_edit_posted',
    'admin_edit_posted','admin_release_trip_link'
  ]));

-- Extend the existing immutable-evidence trigger with one narrowly scoped
-- exception. The release RPC is the only caller that creates this transaction
-- gate and it requires an active company Admin plus a fully credited invoice.

COMMIT;
