CREATE OR REPLACE FUNCTION public.transport_financial_read_allowed(p_side text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id();
BEGIN
  IF auth.uid() IS NULL OR c IS NULL OR b IS NULL OR p_side NOT IN ('customer','supplier') THEN RETURN false; END IF;
  IF NOT public.has_module_permission(c,'transport','view') THEN RETURN false; END IF;
  RETURN true;
END
$function$;