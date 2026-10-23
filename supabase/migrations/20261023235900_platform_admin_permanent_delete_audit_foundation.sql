-- Production-aligned posted control hardening.
-- Restrict the legacy posted-control capability to platform super administrators.
CREATE OR REPLACE FUNCTION public.owner_posted_control_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT auth.uid() IS NOT NULL
 AND public.is_platform_owner()
 AND public.current_company_id() IS NOT NULL
 AND public.current_business_unit_id() IS NOT NULL;
$function$;
REVOKE ALL ON FUNCTION public.owner_posted_control_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_posted_control_access() TO authenticated;

-- Reserve a distinct audit event for permanent deletion. This migration
-- does NOT enable deletion or bypass any posted-record immutability triggers.
ALTER TABLE public.owner_posted_control_events
 DROP CONSTRAINT owner_posted_control_events_action_type_check;
ALTER TABLE public.owner_posted_control_events
 ADD CONSTRAINT owner_posted_control_events_action_type_check
 CHECK (action_type IN ('cancel','correct','reverse','permanent_delete'));
