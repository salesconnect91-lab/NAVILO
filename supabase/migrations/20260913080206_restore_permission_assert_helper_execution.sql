revoke all on function public.assert_module_permission(text,text) from public, anon;
grant execute on function public.assert_module_permission(text,text) to authenticated, service_role;
