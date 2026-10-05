-- Allow Platform Owner to permanently remove only a genuinely unused company.
-- Financial/operational evidence remains protected by protect_company_financial_history.
-- Foreign-key RESTRICT/NO ACTION references remain authoritative; no forced cascade cleanup.
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

  -- The BEFORE DELETE financial-history trigger and all existing FK constraints
  -- are intentionally left in force. If any protected evidence/reference exists,
  -- this statement fails atomically and the company is preserved.
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
