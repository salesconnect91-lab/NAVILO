CREATE OR REPLACE FUNCTION public.posted_journal_delete_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $fn$ SELECT auth.uid() IS NOT NULL $fn$;