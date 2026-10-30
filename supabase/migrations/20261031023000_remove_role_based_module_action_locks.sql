CREATE OR REPLACE FUNCTION public.has_module_permission(p_company_id uuid, p_module text, p_action text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_bu uuid := public.current_business_unit_id();
BEGIN
  IF auth.uid() IS NULL OR p_company_id IS NULL
     OR p_company_id <> public.current_company_id() THEN
    RETURN false;
  END IF;

  IF NOT public.has_company_access(p_company_id) THEN
    RETURN false;
  END IF;

  -- Keep company/BU product entitlements, but remove all role/action-level
  -- permission checks. Every active member in the selected company and BU
  -- can perform view/create/edit/delete/post/print/export actions.
  IF p_module <> 'dashboard'
     AND NOT public.company_module_enabled(p_company_id,p_module) THEN
    RETURN false;
  END IF;

  IF v_bu IS NULL THEN
    RETURN p_module = 'dashboard';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.business_units bu
    JOIN public.business_unit_memberships bm
      ON bm.business_unit_id=bu.id
     AND bm.company_id=bu.company_id
    WHERE bu.id=v_bu
      AND bu.company_id=p_company_id
      AND bu.is_active
      AND bm.user_id=auth.uid()
      AND bm.is_active
  ) THEN
    RETURN false;
  END IF;

  IF p_module <> 'dashboard' AND NOT EXISTS (
    SELECT 1
    FROM public.business_unit_modules bum
    WHERE bum.company_id=p_company_id
      AND bum.business_unit_id=v_bu
      AND bum.module_key=p_module
      AND bum.enabled
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END
$function$;