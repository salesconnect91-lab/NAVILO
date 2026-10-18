-- Enforce company owner or platform owner for posted manual/payment cancellation.
-- Retain ledger immutability; existing posted evidence stays untouched.
BEGIN;
CREATE OR REPLACE FUNCTION public.owner_posted_control_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public,pg_temp AS $body$
 SELECT auth.uid() IS NOT NULL
   AND public.current_company_id() IS NOT NULL
   AND public.current_business_unit_id() IS NOT NULL
   AND (
     public.is_platform_owner()
     OR EXISTS(
       SELECT 1 FROM public.company_memberships m
       JOIN public.user_profiles u ON u.id=m.user_id
       WHERE m.user_id=auth.uid() AND m.company_id=public.current_company_id()
         AND m.is_active AND u.is_active AND m.role='company_owner'
     )
   );
$body$;
REVOKE ALL ON FUNCTION public.owner_posted_control_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.owner_posted_control_access() TO authenticated;
COMMIT;