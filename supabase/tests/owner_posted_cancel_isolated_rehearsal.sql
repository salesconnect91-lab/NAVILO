-- Isolated CI only. Synthetic tenants/users, no production records.
-- Entire fixture is rolled back even after successful posting/cancellation.
begin;
do $$
declare
  v_platform uuid:=gen_random_uuid();
  v_company_owner uuid:=gen_random_uuid();
  v_company uuid; v_unit uuid; v_loc uuid;
  v_cash uuid; v_exp uuid; v_journal uuid; v_reversal uuid;
  v_result jsonb; v_debit numeric; v_credit numeric; v_n int;
  v_ctx text;
  v_code text:substr(replace(gen_random_uuid()::text,'-',''),1,12);
begin
  insert into auth.users(id,role,email,created_at,updated_at)
  values(v_platform,'authenticated','platform-'||v_code||'@navilo.test',now(),now()),
        (v_company_owner,'authenticated','tenant-'||v_code||'@navilo.test',now(),now());
  insert into public.user_profiles(id,user_id,email,role,platform_role,is_active)
  values(v_platform,v_platform,'platform-'||v_code||'@navilo.test','admin','super_admin',true),
        (v_company_owner,v_company_owner,'tenant-'||v_code||'@navilo.test','admin','user',true);
  insert into public.companies(name,code,status,base_currency_code)
  values('Owner cancellation isolated rehearsal','OC'||v_code,'active','SAR') returning id into v_company;
  select id into strict v_unit from public.business_units where company_id=v_company and is_default;
  insert into public.company_memberships(company_id,user_id,role,is_active)
  values(v_company,v_platform,'company_owner',true),(v_company,v_company_owner,'company_owner',true);
  insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active)
  values(v_company,v_unit,v_platform,'company_owner',true),(v_company,v_unit,v_company_owner,'company_owner',true)
  on conflict(business_unit_id,user_id) do update set is_active=true;
  insert into public.business_unit_modules(business_unit_id,company_id,module_key,enabled)
  values(v_unit,v_company,'accounting',true)
  on conflict(business_unit_id,module_key) do update set enabled=true;
  insert into public.platform_features(feature_key,module_key,label,category,supported_actions,default_enabled,core_locked,is_active,source)
  values('journal','accounting','Journal Entries','transaction',
         array['view','create','edit','post','delete','print','export']::text[],true,false,true,'test')
  on conflict(feature_key) do update set default_enabled=true,is_active=true;
  insert into public.company_feature_entitlements(company_id,feature_key,enabled,action_overrides)
  values(v_company,'journal',true,'{}'::jsonb)
  on conflict(company_id,feature_key) do update set enabled=true,action_overrides='{}'::jsonb;
  insert into public.operating_locations(company_id,business_unit_id,code,name,location_type,is_active)
  values(v_company,v_unit,'OC-BR','Owner cancellation test location','branch',true)
  returning id into v_loc;
  insert into public.operating_location_memberships
    (company_id,business_unit_id,operating_location_id,user_id,role,is_active)
  values(v_company,v_unit,v_loc,v_platform,'company_owner',true),
        (v_company,v_unit,v_loc,v_company_owner,'company_owner',true);
  update public.user_profiles set last_company_id=v_company,last_business_unit_id=v_unit
  where id in (v_platform,v_company_owner);
  perform set_config('request.jwt.claim.sub',v_platform::text,true);
  perform public.initialize_default_coa();
  select account_id into strict v_cash from public.account_mappings
  where company_id=v_company and mapping_key='cash';
  select id into strict v_exp from public.chart_of_accounts
  where company_id=v_company and type='expense' and is_active and not is_group
    and allow_manual_entries limit 1;
  insert into public.journal_entries(
    user_id,company_id,business_unit_id,operating_location_id,
    entry_no,entry_date,description,status,trans_type,currency_code,exchange_rate
  ) values(
    v_platform,v_company,v_unit,v_loc,'OC-TEST-'||v_code,current_date,
    'Synthetic cancellation verification','draft','General','SAR',1
  ) returning id into v_journal;
  insert into public.journal_lines(
    user_id,company_id,business_unit_id,operating_location_id,entry_id,
    account_id,account,debit,credit
  ) select v_platform,v_company,v_unit,v_loc,v_journal,id,name,125,0
    from public.chart_of_accounts where id=v_exp;
  insert into public.journal_lines(
    user_id,company_id,business_unit_id,operating_location_id,entry_id,
    account_id,account,debit,credit
  ) select v_platform,v_company,v_unit,v_loc,v_journal,id,name,0,125
    from public.chart_of_accounts where id=v_cash;
  set local role authenticated;
  v_result:=public.post_journal_entry(v_journal);
  if v_result->>'status'<>'posted' then raise exception 'FAIL: synthetic journal not posted'; end if;
  if not public.owner_posted_control_access() then
    raise exception 'FAIL: active software owner cannot access cancellation';
  end if;
  begin
    perform public.owner_cancel_manual_journal(v_journal,current_date-1,'Old date must be rejected');
    raise exception 'FAIL: cancellation accepted date before original journal';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    if position('cannot precede' in sqlerrm)=0 then raise; end if;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub',v_company_owner::text,true);
  set local role authenticated;
  if public.owner_posted_control_access() then
    raise exception 'FAIL: company owner granted software-owner cancellation';
  end if;
  begin
    perform public.owner_cancel_manual_journal(v_journal,current_date,'Company owner must be denied');
    raise exception 'FAIL: company owner cancelled posted journal';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    if position('Only the active company owner or platform owner' in sqlerrm)=0
       and position('Only the NAVILO software owner' in sqlerrm)=0 then raise; end if;
  end;
  select count(*) into v_n from public.owner_posted_control_events
  where company_id=v_company;
  if v_n<>0 then raise exception 'FAIL: rejected cancellation created audit evidence'; end if;
  reset role;
  perform set_config('request.jwt.claim.sub',v_platform::text,true);
  set local role authenticated;
  v_result:=public.owner_cancel_manual_journal(v_journal,current_date,'Isolated test correction');
  v_reversal:=(v_result->>'reversal_entry_id')::uuid;
  if v_result->>'success'<>'true' or v_reversal is null then
    raise exception 'FAIL: owner cancellation did not return posted reversal';
  end if;
  if (select status from public.journal_entries where id=v_journal)<>'posted'
     or (select status from public.journal_entries where id=v_reversal)<>'posted' then
    raise exception 'FAIL: original/reversal not preserved as posted';
  end if;
  select coalesce(sum(debit),0),coalesce(sum(credit),0)
  into v_debit,v_credit from public.ledgers
  where journal_entry_id in (v_journal,v_reversal) and company_id=v_company;
  if v_debit<>250 or v_credit<>250 then
    raise exception 'FAIL: expected original+reversal GL debit/credit 250, got %/%',v_debit,v_credit;
  end if;
  if exists(
    select 1 from public.ledgers where journal_entry_id in(v_journal,v_reversal)
    group by account_id having abs(sum(debit-credit))>=0.01
  ) then raise exception 'FAIL: original+reversal account net balance not zero'; end if;
  if (select count(*) from public.owner_posted_control_events
      where company_id=v_company and document_id=v_journal and reversal_document_id=v_reversal
        and action_type='cancel' and document_type='manual_journal')<>1 then
    raise exception 'FAIL: owner audit original/reversal link missing';
  end if;
  select count(*) into v_n from public.owner_cancelled_journal_ids()
  where entry_id in(v_journal,v_reversal);
  if v_n<>2 then raise exception 'FAIL: cancelled journal IDs missing from normal-list exclusion'; end if;
  begin
    perform public.owner_cancel_manual_journal(v_journal,current_date,'Duplicate must be rejected');
    raise exception 'FAIL: duplicate cancellation allowed';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  raise notice 'PASS owner cancellation: software-owner only; company-owner denied; backdate denied; posted originals preserved; per-account GL net zero; audit linked; list exclusions; duplicate denied';
exception when others then
  get stacked diagnostics v_ctx=PG_EXCEPTION_CONTEXT;
  raise exception 'OWNER TEST FAILURE: % | CONTEXT: %',SQLERRM,v_ctx;
end $;
rollback;
