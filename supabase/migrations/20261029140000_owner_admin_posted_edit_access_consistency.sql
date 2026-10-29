-- Keep posted manual journal edit authorization aligned with the centralized Owner Control gate.
-- Active platform owner, company Owner, and company Main Admin can edit eligible posted journals.
-- Source-linked documents remain subject to their own audited correction workflow.
BEGIN;

CREATE OR REPLACE FUNCTION public.company_admin_posted_journal_edit_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.owner_posted_control_access();
$function$;

REVOKE ALL ON FUNCTION public.company_admin_posted_journal_edit_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_admin_posted_journal_edit_access() TO authenticated;

COMMENT ON FUNCTION public.company_admin_posted_journal_edit_access() IS
  'Posted manual journal edit authorization is aligned with the active Owner Control gate: platform owner, company owner, or authorized company Main Admin. Source-linked journals must be corrected from their source module.';

COMMIT;