revoke all on function public.legacy_data_user_id() from public, anon, authenticated;
grant execute on function public.legacy_data_user_id() to service_role;
