create or replace function public.platform_delete_company(p_company_id uuid,p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_company record;
begin
  select id,code,name into v_company
  from public.companies
  where id=p_company_id
  for update;

  if not found then
    raise exception 'Company not found.';
  end if;

  if exists(select 1 from public.journal_entries where company_id=p_company_id)
    or exists(select 1 from public.ledgers where company_id=p_company_id)
    or exists(select 1 from public.party_ledgers where company_id=p_company_id)
    or exists(select 1 from public.sales_orders where company_id=p_company_id)
    or exists(select 1 from public.purchase_orders where company_id=p_company_id)
    or exists(select 1 from public.stock_movements where company_id=p_company_id)
    or exists(select 1 from public.transport_trips where company_id=p_company_id) then
    raise exception 'Company with financial or operational evidence cannot be deleted. Suspend or close it instead.';
  end if;

  -- Clear non-evidence UI/session pointers that otherwise RESTRICT deletion of the
  -- bootstrapped business unit. Locked scope is intentionally not cleared.
  update public.user_profiles
  set last_business_unit_id=null
  where last_business_unit_id in (
    select id from public.business_units where company_id=p_company_id
  );

  -- Default mappings depend on default COA, so remove in dependency order.
  delete from public.account_mappings where company_id=p_company_id;
  delete from public.chart_of_accounts where company_id=p_company_id;

  -- Remaining RESTRICT/NO ACTION references stay authoritative. Any user-created
  -- master/operational dependency makes this statement fail and rolls back cleanup.
  delete from public.companies where id=p_company_id;

  if not found then
    raise exception 'Company could not be deleted.';
  end if;

  return jsonb_build_object(
    'deleted',true,
    'company_id',p_company_id,
    'company_code',v_company.code,
    'company_name',v_company.name,
    'actor_id',p_actor_id
  );
exception
  when foreign_key_violation then
    raise exception 'This company is already referenced by users, transactions or operational records. Suspend or close it instead.';
end
$function$;

revoke all on function public.platform_delete_company(uuid,uuid) from public,anon,authenticated;
grant execute on function public.platform_delete_company(uuid,uuid) to service_role;
