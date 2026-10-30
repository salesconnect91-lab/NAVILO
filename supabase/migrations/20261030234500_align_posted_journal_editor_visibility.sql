CREATE OR REPLACE FUNCTION public.company_admin_posted_journal_edit_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND public.has_module_permission(public.current_company_id(),'accounting','edit');
$function$;