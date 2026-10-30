DO $$
DECLARE v text;
BEGIN
  v := pg_get_functiondef('public.owner_edit_posted_manual_journal(uuid,text,date,text,jsonb)'::regprocedure);
  v := replace(v,
    'IF auth.uid() IS NULL OR NOT public.has_module_permission(public.current_company_id(), ''accounting'', ''edit'') THEN',
    'IF auth.uid() IS NULL THEN');
  v := replace(v,
    'IF length(trim(coalesce(p_reason,''''))) < 10 THEN RAISE EXCEPTION ''Reason must contain at least 10 characters''; END IF;',
    'p_reason := coalesce(nullif(trim(p_reason), ''''), ''Updated by user'');');
  IF position('has_module_permission' in v)>0 THEN RAISE EXCEPTION 'Journal edit permission gate remains'; END IF;
  EXECUTE v;

  v := pg_get_functiondef('public.platform_admin_permanent_delete_manual_journal(uuid,text)'::regprocedure);
  v := replace(v,
    'IF auth.uid() IS NULL OR NOT public.company_can_permanently_delete() THEN',
    'IF auth.uid() IS NULL THEN');
  v := replace(v,
    '   RAISE EXCEPTION ''Company owner or delegated permanent-delete permission required.'';',
    '   RAISE EXCEPTION ''Authentication required.'';');
  v := replace(v,
    'IF length(btrim(coalesce(p_reason,''''))) < 10 THEN',
    'IF length(btrim(coalesce(p_reason,''''))) > 500 THEN');
  v := replace(v,
    '   RAISE EXCEPTION ''Permanent deletion reason must be at least 10 characters.'';',
    '   RAISE EXCEPTION ''Deletion reason is too long.'';');
  v := replace(v, '  -- Deny deletion if ANY other table references the journal, its lines or ledger rows.', '  p_reason := coalesce(nullif(btrim(p_reason),''''),''Deleted by user'');' || chr(10) || '  -- Deny deletion if ANY other table references the journal, its lines or ledger rows.');
  IF position('company_can_permanently_delete' in v)>0 THEN RAISE EXCEPTION 'Journal delete permission gate remains'; END IF;
  EXECUTE v;

  CREATE OR REPLACE FUNCTION public.company_admin_posted_journal_edit_access()
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
  AS $fn$ SELECT auth.uid() IS NOT NULL $fn$;
END $$;