-- Keep posted-record controls restricted to the platform owner and authorized company/BU admins.
-- Expand "company admin" helpers to include delegated BU admins consistently.
-- Preserve company, BU, branch context, RLS, audit triggers, accounting validation and posting side effects.
CREATE OR REPLACE FUNCTION public.company_admin_posted_journal_edit_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
  SELECT public.owner_posted_control_access();
$function$;

CREATE OR REPLACE FUNCTION public.posted_journal_delete_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
  SELECT public.owner_posted_control_access();
$function$;

CREATE OR REPLACE FUNCTION navilo_private.transport_invoice_admin_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND public.current_company_id() IS NOT NULL
    AND public.current_business_unit_id() IS NOT NULL
    AND public.current_operating_location_id() IS NOT NULL
    AND public.owner_posted_control_access();
$function$;
