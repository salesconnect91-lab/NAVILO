begin;
do $test$
declare fn text; blocked boolean;
begin
  foreach fn in array array['platform_reset_company_transactions','platform_delete_company'] loop
    if has_function_privilege('anon','public.'||fn||'(uuid,uuid)','execute')
      or has_function_privilege('authenticated','public.'||fn||'(uuid,uuid)','execute') then
      raise exception 'Destructive control-plane function is exposed: %',fn;
    end if;
    perform set_config('request.jwt.claim.role','service_role',true);
    perform set_config('request.jwt.claims','{"role":"service_role"}',true);
    blocked:=false;
    begin
      execute format('select public.%I($1,$2)',fn) using gen_random_uuid(),gen_random_uuid();
    exception when raise_exception then
      if sqlerrm not like '%disabled%' then raise; end if;
      blocked:=true;
    end;
    if not blocked then raise exception 'History removal unexpectedly permitted: %',fn; end if;
  end loop;
  if not exists(select 1 from pg_trigger where tgrelid='public.companies'::regclass
    and tgname='protect_company_financial_history' and tgenabled='O') then
    raise exception 'Company history deletion guard missing';
  end if;
end $test$;
rollback;
