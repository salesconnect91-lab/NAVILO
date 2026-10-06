begin;
do $test$
declare blocked boolean;
begin
  -- Transaction reset is intentionally available only through the guarded
  -- service-role control plane, and must fail closed for an unknown company.
  if has_function_privilege('anon','public.platform_reset_company_transactions(uuid,uuid)','execute')
    or has_function_privilege('authenticated','public.platform_reset_company_transactions(uuid,uuid)','execute') then
    raise exception 'Destructive transaction reset is exposed';
  end if;
  if to_regprocedure('public.navilo_require_service_role_rpc()') is null then
    raise exception 'Service-role guard helper missing';
  end if;
  perform set_config('request.jwt.claim.role','service_role',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  blocked:=false;
  begin
    perform public.platform_reset_company_transactions(gen_random_uuid(),gen_random_uuid());
  exception when raise_exception then
    if sqlerrm not like '%Company not found%' then raise; end if;
    blocked:=true;
  end;
  if not blocked then raise exception 'Missing-company transaction reset unexpectedly succeeded'; end if;

  -- Company deletion is intentionally available only through the guarded
  -- service-role control plane. A missing UUID must fail without mutation.
  if has_function_privilege('anon','public.platform_delete_company(uuid,uuid)','execute')
    or has_function_privilege('authenticated','public.platform_delete_company(uuid,uuid)','execute') then
    raise exception 'Company deletion control is exposed to client roles';
  end if;
  blocked:=false;
  begin
    perform public.platform_delete_company(gen_random_uuid(),gen_random_uuid());
  exception when raise_exception then
    if sqlerrm not like '%Company not found%' then raise; end if;
    blocked:=true;
  end;
  if not blocked then raise exception 'Missing-company deletion unexpectedly succeeded'; end if;

  if not exists(select 1 from pg_trigger where tgrelid='public.companies'::regclass
    and tgname='protect_company_financial_history' and tgenabled='O') then
    raise exception 'Company history deletion guard missing';
  end if;
end $test$;
rollback;
