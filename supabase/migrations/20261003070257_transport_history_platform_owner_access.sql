-- Match NAVILO's established Platform Owner administration behavior while
-- retaining the same scoped finance guards and immutable job ownership.
create or replace function public.transport_history_import_assert() returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null or public.current_company_id() is null or public.current_business_unit_id() is null
 or public.current_operating_location_id() is null or (not public.is_platform_owner() and not exists(
 select 1 from public.business_unit_memberships where company_id=public.current_company_id()
 and business_unit_id=public.current_business_unit_id() and user_id=auth.uid() and is_active
 and role in ('company_owner','admin'))) then raise exception 'Workspace administrator required for one-time historical import';end if;
 perform public.transport_finance_assert('billing');perform public.transport_finance_assert('rent');perform public.transport_finance_assert('settlement');
end $$;
revoke all on function public.transport_history_import_assert() from public,anon,authenticated;
