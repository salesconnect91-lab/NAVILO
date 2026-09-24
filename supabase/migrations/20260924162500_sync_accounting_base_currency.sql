-- The accounting policy predates companies.base_currency_code. Keep both
-- configuration surfaces aligned while the existing company trigger blocks
-- changes after posting or recording FX rates.
create function public.sync_accounting_policy_base_currency()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_base text;
begin
  select base_currency_code into v_base
    from public.companies where id=new.company_id for update;
  if v_base is null then raise exception 'Company does not exist'; end if;
  if tg_op='INSERT' then
    new.base_currency:=v_base;
    return new;
  end if;
  if new.base_currency is distinct from v_base then
    update public.companies set base_currency_code=new.base_currency
      where id=new.company_id;
  end if;
  return new;
end $$;
revoke all on function public.sync_accounting_policy_base_currency()
  from public,anon,authenticated;
create trigger sync_accounting_policy_base_currency
before insert or update of base_currency on public.company_accounting_policies
for each row execute function public.sync_accounting_policy_base_currency();

create function public.sync_company_base_currency_to_policy()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  -- A policy update already owns its row; avoid updating it again from the
  -- nested company trigger before the outer statement has completed.
  if pg_trigger_depth()>1 then return new; end if;
  update public.company_accounting_policies
     set base_currency=new.base_currency_code
   where company_id=new.id and base_currency is distinct from new.base_currency_code;
  return new;
end $$;
revoke all on function public.sync_company_base_currency_to_policy()
  from public,anon,authenticated;
create trigger sync_company_base_currency_to_policy
after update of base_currency_code on public.companies
for each row when (old.base_currency_code is distinct from new.base_currency_code)
execute function public.sync_company_base_currency_to_policy();
