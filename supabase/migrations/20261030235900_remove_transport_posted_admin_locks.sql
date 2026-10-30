DO $$
DECLARE v text;
BEGIN
  -- Posted Transport invoice controls are no longer Owner/Admin-only.
  CREATE OR REPLACE FUNCTION navilo_private.transport_invoice_admin_access()
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public','pg_temp'
  AS $fn$
    SELECT auth.uid() IS NOT NULL
      AND public.current_company_id() IS NOT NULL
      AND public.current_business_unit_id() IS NOT NULL
      AND public.current_operating_location_id() IS NOT NULL;
  $fn$;

  v := pg_get_functiondef('navilo_private.transport_posted_invoice_edit_context(text,uuid)'::regprocedure);
  v := replace(v, '  IF NOT navilo_private.transport_invoice_admin_access() THEN RAISE EXCEPTION ''Active company/business-unit Admin required''; END IF;', '  IF auth.uid() IS NULL OR public.current_company_id() IS NULL OR public.current_business_unit_id() IS NULL OR public.current_operating_location_id() IS NULL THEN RAISE EXCEPTION ''Select an active company, business unit and location''; END IF;');
  v := replace(v, '    PERFORM public.transport_finance_assert(''billing'');' || chr(10) || '    PERFORM public.assert_module_permission(''sales'',''edit'');', '');
  v := replace(v, '    PERFORM public.transport_finance_assert(''rent'');' || chr(10) || '    PERFORM public.assert_module_permission(''purchase'',''edit'');', '');
  IF position('owner_posted_control_access' in v)>0 OR position('transport_finance_assert' in v)>0 OR position('assert_module_permission' in v)>0 THEN
    RAISE EXCEPTION 'Posted Transport edit-context gates were not fully removed';
  END IF;
  EXECUTE v;

  v := pg_get_functiondef('navilo_private.transport_control_invoice(text,uuid,text,uuid[],date,text,jsonb)'::regprocedure);
  v := replace(v, ' IF NOT navilo_private.transport_invoice_admin_access() THEN RAISE EXCEPTION ''Active company/business-unit Admin required'';END IF;', ' IF auth.uid() IS NULL OR public.current_company_id() IS NULL OR public.current_business_unit_id() IS NULL OR public.current_operating_location_id() IS NULL THEN RAISE EXCEPTION ''Select an active company, business unit and location'';END IF;');
  v := replace(v, ' OR length(btrim(coalesce(p_reason,''''))) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION ''Side, action and audit reason of at least 10 characters required'';END IF;', ' OR length(btrim(coalesce(p_reason,''''))) > 500 THEN RAISE EXCEPTION ''Side and action are required'';END IF; p_reason := coalesce(nullif(btrim(p_reason),''''),''Updated by user'');');
  v := replace(v, ' PERFORM public.transport_finance_assert(CASE WHEN p_side=''customer'' THEN ''billing'' ELSE ''rent'' END);' || chr(10) || ' PERFORM public.assert_module_permission(CASE WHEN p_side=''customer'' THEN ''sales'' ELSE ''purchase'' END,CASE WHEN p_action=''delete'' THEN ''delete'' ELSE ''edit'' END);', '');
  IF position('owner_posted_control_access' in v)>0 OR position('transport_finance_assert' in v)>0 OR position('assert_module_permission' in v)>0 THEN
    RAISE EXCEPTION 'Posted Transport invoice control gates were not fully removed';
  END IF;
  EXECUTE v;
END $$;