-- Posted-record edit/cancel/delete controls belong only to Main Admin / Owner Control.
-- Keep this role gate consistent across accounting, invoice cancellation review,
-- transport invoice controls, and audited permanent journal deletion.

CREATE OR REPLACE FUNCTION public.owner_posted_control_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND public.current_company_id() IS NOT NULL
    AND public.current_business_unit_id() IS NOT NULL
    AND (
      public.is_platform_owner()
      OR EXISTS (
        SELECT 1
        FROM public.company_memberships m
        JOIN public.user_profiles u ON u.id = m.user_id
        WHERE m.company_id = public.current_company_id()
          AND m.user_id = auth.uid()
          AND m.is_active
          AND u.is_active
          AND m.role IN ('admin', 'owner', 'company_owner')
      )
      OR EXISTS (
        SELECT 1
        FROM public.business_unit_memberships m
        JOIN public.user_profiles u ON u.id = m.user_id
        WHERE m.company_id = public.current_company_id()
          AND m.business_unit_id = public.current_business_unit_id()
          AND m.user_id = auth.uid()
          AND m.is_active
          AND u.is_active
          AND m.role IN ('admin', 'owner', 'company_owner')
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.owner_posted_control_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_posted_control_access() TO authenticated;

COMMENT ON FUNCTION public.owner_posted_control_access() IS
  'Authorization gate for posted-record controls. Allows active platform owner, company Main Admin, or company Owner Control role in the selected company and business unit.';

CREATE OR REPLACE FUNCTION public.company_can_permanently_delete()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND public.current_company_id() IS NOT NULL
    AND public.current_business_unit_id() IS NOT NULL
    AND (
      public.owner_posted_control_access()
      OR (
        EXISTS (
          SELECT 1
          FROM public.company_memberships m
          WHERE m.company_id = public.current_company_id()
            AND m.user_id = auth.uid()
            AND m.is_active
        )
        AND EXISTS (
          SELECT 1
          FROM public.company_permanent_delete_grants g
          WHERE g.company_id = public.current_company_id()
            AND g.user_id = auth.uid()
            AND g.allowed
        )
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.company_can_permanently_delete() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_can_permanently_delete() TO authenticated;

COMMENT ON FUNCTION public.company_can_permanently_delete() IS
  'Allows audited permanent deletion controls to the active platform owner, company Main Admin, company Owner Control role, or an explicitly delegated company delete-control grant.';

CREATE OR REPLACE FUNCTION navilo_private.transport_invoice_admin_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND public.owner_posted_control_access()
    AND public.current_operating_location_id() IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION navilo_private.transport_invoice_admin_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION navilo_private.transport_invoice_admin_access() TO authenticated;

COMMENT ON FUNCTION navilo_private.transport_invoice_admin_access() IS
  'Role gate for posted transport invoice edit/delete and trip correction controls. Uses the centralized Main Admin / Owner Control posted-record policy and requires an active branch.';
