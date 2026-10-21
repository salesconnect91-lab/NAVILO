-- Posted-record cancellation/review controls belong to an active company Admin only.
-- Company Owners and NAVILO platform owners must not bypass this tenant Admin gate.
-- This changes authorization only; posted accounting evidence is never deleted or edited.
CREATE OR REPLACE FUNCTION public.owner_posted_control_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public,pg_temp
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND public.current_company_id() IS NOT NULL
    AND public.current_business_unit_id() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.business_unit_memberships m
      JOIN public.user_profiles u ON u.id=m.user_id
      WHERE m.company_id=public.current_company_id()
        AND m.business_unit_id=public.current_business_unit_id()
        AND m.user_id=auth.uid()
        AND m.role='admin'
        AND m.is_active
        AND u.is_active
    );
$function$;
REVOKE ALL ON FUNCTION public.owner_posted_control_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_posted_control_access() TO authenticated;

DROP POLICY IF EXISTS owner_posted_control_owner_read ON public.owner_posted_control_events;
CREATE POLICY owner_posted_control_admin_read ON public.owner_posted_control_events
FOR SELECT TO authenticated
USING (
  company_id=public.current_company_id()
  AND business_unit_id=public.current_business_unit_id()
  AND public.owner_posted_control_access()
);

COMMENT ON FUNCTION public.owner_posted_control_access() IS
  'Authorization for posted-record review/cancellation. Only an active company Admin in the current business unit is eligible.';
