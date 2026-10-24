-- Restore authorized company-owner access alongside active BU Admin access.
-- Posted standalone manual edits remain in-place with audited before/after history.
CREATE OR REPLACE FUNCTION public.company_admin_posted_journal_edit_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
  SELECT auth.uid() IS NOT NULL
    AND public.current_company_id() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.user_profiles u
        WHERE u.id = auth.uid()
          AND u.is_active
          AND u.platform_role = 'super_admin'
      )
      OR EXISTS (
        SELECT 1
        FROM public.company_memberships m
        JOIN public.user_profiles u ON u.id = m.user_id
        WHERE m.company_id = public.current_company_id()
          AND m.user_id = auth.uid()
          AND m.is_active
          AND m.role IN ('owner', 'company_owner')
          AND u.is_active
      )
      OR (
        public.current_business_unit_id() IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.business_unit_memberships m
          JOIN public.user_profiles u ON u.id = m.user_id
          WHERE m.company_id = public.current_company_id()
            AND m.business_unit_id = public.current_business_unit_id()
            AND m.user_id = auth.uid()
            AND m.role = 'admin'
            AND m.is_active
            AND u.is_active
        )
      )
    );
$function$;
REVOKE ALL ON FUNCTION public.company_admin_posted_journal_edit_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_admin_posted_journal_edit_access() TO authenticated;
COMMENT ON FUNCTION public.company_admin_posted_journal_edit_access() IS
  'True only for an active platform super admin, company owner, or Admin assigned to the selected company/business unit.';
