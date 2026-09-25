-- Local isolated database only. All tenant and account rows roll back.
begin;
do $$
declare
  v_user uuid:=gen_random_uuid(); v_company uuid; v_other_company uuid; v_unit uuid;
  v_gain uuid; v_loss uuid; v_other_gain uuid; v_rejected boolean;
  v_code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
begin
  insert into auth.users(id,role,email,created_at,updated_at)
  values(v_user,'authenticated','fx-account-'||v_code||'@navilo.test',now(),now());
  insert into public.user_profiles(id,user_id,email,role,platform_role,is_active)
  values(v_user,v_user,'fx-account-'||v_code||'@navilo.test','admin','user',true);
  insert into public.companies(name,code,status)
  values('FX accounts rehearsal','FA'||v_code,'active') returning id into v_company;
  select id into strict v_unit from public.business_units where company_id=v_company and is_default;
  insert into public.company_memberships(company_id,user_id,role,is_active)
  values(v_company,v_user,'company_owner',true);
  insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active)
  values(v_company,v_unit,v_user,'company_owner',true)
  on conflict(business_unit_id,user_id) do update set role='company_owner',is_active=true;
  insert into public.business_unit_modules(business_unit_id,company_id,module_key,enabled)
  values(v_unit,v_company,'accounting',true)
  on conflict(business_unit_id,module_key) do update set enabled=true;
  update public.user_profiles set last_company_id=v_company,last_business_unit_id=v_unit where id=v_user;
  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform public.initialize_default_coa();

  select id into strict v_gain from public.chart_of_accounts
  where company_id=v_company and code='4100';
  select id into strict v_loss from public.chart_of_accounts
  where company_id=v_company and code='6500';
  insert into public.account_mappings(user_id,company_id,mapping_key,account_id)
  values(v_user,v_company,'fx_gain',v_gain),(v_user,v_company,'fx_loss',v_loss);
  if (select count(*) from public.account_mappings where company_id=v_company
        and mapping_key in ('fx_gain','fx_loss'))<>2 then
    raise exception 'FX gain and loss account mappings were not persisted';
  end if;

  v_rejected:=false;
  begin
    update public.account_mappings set account_id=v_gain
    where company_id=v_company and mapping_key='fx_loss';
  exception when raise_exception then v_rejected:=true;
  end;
  if not v_rejected then raise exception 'FX loss accepted a revenue account'; end if;
  v_rejected:=false;
  begin
    update public.chart_of_accounts set is_active=false where id=v_gain;
  exception when raise_exception then v_rejected:=true;
  end;
  if not v_rejected then raise exception 'Mapped FX gain account was deactivated'; end if;

  insert into public.companies(name,code,status)
  values('Other FX accounts rehearsal','FB'||v_code,'active') returning id into v_other_company;
  insert into public.company_memberships(company_id,user_id,role,is_active)
  values(v_other_company,v_user,'company_owner',true);
  select id into strict v_unit from public.business_units where company_id=v_other_company and is_default;
  insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active)
  values(v_other_company,v_unit,v_user,'company_owner',true)
  on conflict(business_unit_id,user_id) do update set role='company_owner',is_active=true;
  insert into public.business_unit_modules(business_unit_id,company_id,module_key,enabled)
  values(v_unit,v_other_company,'accounting',true)
  on conflict(business_unit_id,module_key) do update set enabled=true;
  update public.user_profiles set last_company_id=v_other_company,last_business_unit_id=v_unit where id=v_user;
  perform public.initialize_default_coa();
  select id into strict v_other_gain from public.chart_of_accounts
  where company_id=v_other_company and code='4100';
  select id into strict v_unit from public.business_units where company_id=v_company and is_default;
  update public.user_profiles set last_company_id=v_company,last_business_unit_id=v_unit where id=v_user;
  v_rejected:=false;
  begin
    update public.account_mappings set account_id=v_other_gain
    where company_id=v_company and mapping_key='fx_gain';
  exception when raise_exception then v_rejected:=true;
  end;
  if not v_rejected then raise exception 'FX gain accepted an account from another company'; end if;
  raise notice 'PASS: company FX mappings accept typed accounts, reject wrong type/cross-company and protect mapped account lifecycle';
end $$;
rollback;
