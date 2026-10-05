-- Journal Advanced-feature authorization regression.
-- Isolated database only; all synthetic rows roll back.
begin;

do $$
declare
  v_user uuid:=gen_random_uuid();
  v_company uuid;
  v_bu uuid;
  v_loc uuid;
  v_entry public.journal_entries%rowtype;
begin
  insert into auth.users(id,role,email,created_at,updated_at)
  values(v_user,'authenticated','journal-feature@navilo.test',now(),now());

  insert into public.user_profiles(id,user_id,email,role,platform_role,is_active)
  values(v_user,v_user,'journal-feature@navilo.test','accountant','user',true);

  insert into public.companies(name,code,status)
  values('Journal Feature Company','JFC_'||substr(replace(gen_random_uuid()::text,'-',''),1,8),'active')
  returning id into v_company;

  select id into v_bu from public.business_units
  where company_id=v_company and is_default;

  insert into public.company_memberships(company_id,user_id,role,is_active)
  values(v_company,v_user,'accounts',true);

  insert into public.business_unit_modules(business_unit_id,company_id,module_key,enabled)
  values(v_bu,v_company,'accounting',true);

  insert into public.operating_locations(company_id,business_unit_id,code,name,location_type,is_active)
  values(v_company,v_bu,'JF-BR','Journal Feature Branch','branch',true)
  returning id into v_loc;

  insert into public.operating_location_memberships
    (company_id,business_unit_id,operating_location_id,user_id,role,is_active)
  values(v_company,v_bu,v_loc,v_user,'accountant',true);

  update public.user_profiles
  set last_company_id=v_company,last_business_unit_id=v_bu
  where id=v_user;

  insert into public.platform_features(
    feature_key,module_key,label,category,supported_actions,default_enabled,core_locked,is_active,source
  ) values(
    'journal','accounting','Journal Entries','transaction',
    array['view','create','edit','post','delete','print','export']::text[],true,false,true,'test'
  )
  on conflict(feature_key) do update set
    module_key=excluded.module_key,supported_actions=excluded.supported_actions,
    default_enabled=true,is_active=true;

  insert into public.company_feature_entitlements(company_id,feature_key,enabled,action_overrides)
  values(v_company,'journal',false,'{}'::jsonb)
  on conflict(company_id,feature_key) do update set enabled=false,action_overrides='{}'::jsonb;

  perform set_config('request.jwt.claim.sub',v_user::text,true);
  set local role authenticated;

  if public.has_feature_access('journal','create') then
    raise exception 'SECURITY FAILURE: disabled Journal feature reports create access';
  end if;

  begin
    perform public.create_manual_journal_entry(current_date,'Disabled Journal probe');
    raise exception 'SECURITY FAILURE: disabled Journal feature created a manual journal';
  exception when others then
    if sqlerrm like 'SECURITY FAILURE:%' then raise; end if;
    if position('Journal create feature permission required.' in sqlerrm)=0 then raise; end if;
  end;

  begin
    insert into public.journal_entries(
      user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,trans_type
    ) values(
      public.legacy_data_user_id(),v_company,v_bu,v_loc,'JF-DIRECT-'||substr(replace(gen_random_uuid()::text,'-',''),1,8),
      current_date,'Direct disabled probe','draft','Manual Journal'
    );
    raise exception 'SECURITY FAILURE: disabled Journal feature allowed direct journal insert';
  exception when others then
    if sqlerrm like 'SECURITY FAILURE:%' then raise; end if;
  end;

  reset role;
  update public.company_feature_entitlements
  set enabled=true,action_overrides='{}'::jsonb
  where company_id=v_company and feature_key='journal';
  set local role authenticated;

  if not public.has_feature_access('journal','create') then
    raise exception 'Enabled Journal feature unexpectedly denies create';
  end if;

  select * into v_entry
  from public.create_manual_journal_entry(current_date,'Enabled Journal probe');

  if v_entry.id is null or v_entry.trans_type is distinct from 'Manual Journal' then
    raise exception 'Enabled Journal feature did not create canonical manual draft';
  end if;

  reset role;
  update public.company_feature_entitlements
  set action_overrides='{"create":false}'::jsonb
  where company_id=v_company and feature_key='journal';
  set local role authenticated;

  if public.has_feature_access('journal','create') then
    raise exception 'SECURITY FAILURE: explicit Journal create FALSE did not win';
  end if;

  begin
    perform public.create_manual_journal_entry(current_date,'Explicit false probe');
    raise exception 'SECURITY FAILURE: explicit Journal create FALSE was bypassed';
  exception when others then
    if sqlerrm like 'SECURITY FAILURE:%' then raise; end if;
    if position('Journal create feature permission required.' in sqlerrm)=0 then raise; end if;
  end;

  raise notice 'PASS: Journal feature authorization enforced at manual create and direct insert boundaries';
end $$;

rollback;
