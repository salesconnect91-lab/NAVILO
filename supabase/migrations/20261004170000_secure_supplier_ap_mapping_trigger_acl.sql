-- Keep the supplier AP mapping helper internal to database/service execution.
-- It is a trigger helper, not a client RPC.
revoke execute on function public.ensure_supplier_ap_mapping() from public, anon, authenticated;
grant execute on function public.ensure_supplier_ap_mapping() to service_role;
