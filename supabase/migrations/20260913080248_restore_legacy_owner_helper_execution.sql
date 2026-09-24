revoke all on function public.legacy_data_user_id() from public, anon;
grant execute on function public.legacy_data_user_id() to authenticated, service_role;
