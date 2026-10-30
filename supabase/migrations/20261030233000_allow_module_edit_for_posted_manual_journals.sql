DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.owner_edit_posted_manual_journal(uuid,text,date,text,jsonb)'::regprocedure);
  v_def := replace(v_def,
    'IF auth.uid() IS NULL OR NOT public.company_admin_posted_journal_edit_access() THEN',
    'IF auth.uid() IS NULL OR NOT public.has_module_permission(public.current_company_id(), ''accounting'', ''edit'') THEN');
  v_def := replace(v_def,
    'IF length(trim(coalesce(p_reason,''''))) < 10 THEN RAISE EXCEPTION ''Reason must contain at least 10 characters''; END IF;',
    'p_reason := coalesce(nullif(trim(p_reason), ''''), ''Posted journal edited'');');
  IF position('public.has_module_permission(public.current_company_id(), ''accounting'', ''edit'')' in v_def)=0 THEN
    RAISE EXCEPTION 'Could not safely replace posted journal edit authorization.';
  END IF;
  EXECUTE v_def;
END $$;