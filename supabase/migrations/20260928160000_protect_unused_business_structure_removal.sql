-- Protected permanent removal for genuinely unused non-default business units.
-- Runs atomically: any remaining FK reference rolls back setup cleanup and blocks removal.
create or replace function public.platform_remove_unused_business_unit(
  p_company_id uuid,
  p_business_unit_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_default boolean;
begin
  select is_default into v_is_default
  from public.business_units
  where id = p_business_unit_id and company_id = p_company_id
  for update;

  if not found then
    raise exception 'Business unit not found for this company.';
  end if;
  if v_is_default then
    raise exception 'The default Business Unit cannot be removed. Make another Business Unit default first.';
  end if;

  if exists (select 1 from public.business_unit_memberships where business_unit_id = p_business_unit_id)
     or exists (select 1 from public.operating_locations where business_unit_id = p_business_unit_id) then
    raise exception 'This Business Unit is already referenced by users or branches. Remove those unused assignments first, or disable it instead.';
  end if;

  delete from public.business_unit_feature_entitlements where company_id = p_company_id and business_unit_id = p_business_unit_id;
  delete from public.business_unit_modules where company_id = p_company_id and business_unit_id = p_business_unit_id;
  delete from public.business_units where id = p_business_unit_id and company_id = p_company_id;

  return true;
exception
  when foreign_key_violation then
    raise exception 'This Business Unit is already referenced by operational or accounting records. Disable it instead.';
end;
$$;

revoke all on function public.platform_remove_unused_business_unit(uuid,uuid) from public, anon, authenticated;
grant execute on function public.platform_remove_unused_business_unit(uuid,uuid) to service_role;
