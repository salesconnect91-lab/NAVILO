-- NAVILO software-owner-only posted cancellation.
-- Company owners and delegated Owner Control users must never be able to
-- cancel posted journals or payment vouchers using the software-owner path.
-- Keep active company/business-unit context to preserve tenant isolation.
create or replace function public.owner_posted_control_access()
returns boolean language sql stable security definer
set search_path to 'public','pg_temp'
as $$
  select auth.uid() is not null
    and public.current_company_id() is not null
    and public.current_business_unit_id() is not null
    and public.is_platform_owner();
$$;
revoke all on function public.owner_posted_control_access() from public, anon;
grant execute on function public.owner_posted_control_access() to authenticated;
