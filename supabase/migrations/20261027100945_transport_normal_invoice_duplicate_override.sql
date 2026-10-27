-- Keep the Normal Invoice Import Center aligned with the authorized duplicate
-- number workflow used by the single-invoice and Trip Register creators.
-- The existing import RPC remains the atomic validator and draft creator.
CREATE OR REPLACE FUNCTION public.transport_normal_invoice_import_vat_with_override(
 p_side text,
 p_rows jsonb,
 p_post boolean DEFAULT false,
 p_allow_duplicate_invoice boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
 previous text;
 result jsonb;
BEGIN
 IF p_allow_duplicate_invoice
    AND NOT public.transport_invoice_duplicate_override_allowed(p_side) THEN
  RAISE EXCEPTION 'Duplicate invoice override permission is required';
 END IF;
 previous:=coalesce(current_setting('app.transport_duplicate_invoice_override',true),'0');
 PERFORM set_config('app.transport_duplicate_invoice_override',CASE WHEN p_allow_duplicate_invoice THEN '1' ELSE '0' END,true);
 result:=public.transport_normal_invoice_import_vat(p_side,p_rows,p_post);
 PERFORM set_config('app.transport_duplicate_invoice_override',previous,true);
 RETURN result;
END
$function$;

REVOKE ALL ON FUNCTION public.transport_normal_invoice_import_vat_with_override(text,jsonb,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.transport_normal_invoice_import_vat_with_override(text,jsonb,boolean,boolean) TO authenticated;
COMMENT ON FUNCTION public.transport_normal_invoice_import_vat_with_override(text,jsonb,boolean,boolean) IS
 'Atomic Normal Invoice Import with optional duplicate-number override restricted to permitted company owners/admins.';
