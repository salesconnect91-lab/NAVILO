-- Priority 1: internal implementation/helper RPCs are not direct API surfaces.
REVOKE ALL ON FUNCTION public.create_and_post_return_note_internal(text,uuid,date,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_sales_invoice_core(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.backfill_company_urdu_names() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_and_post_return_note_internal(text,uuid,date,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.post_sales_invoice_core(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.backfill_company_urdu_names() TO authenticated, service_role;
