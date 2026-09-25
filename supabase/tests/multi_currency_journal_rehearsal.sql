-- Local Supabase only. Synthetic company and journals; every change rolls back.
begin;
do $$
declare
  v_user uuid:=gen_random_uuid(); v_company uuid; v_other uuid; v_unit uuid;
  v_location uuid; v_entry uuid; v_base_entry uuid; v_account uuid;
  v_code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
  v_rate numeric; v_base text; v_debit numeric; v_failed boolean;
begin
  insert into auth.users(id,role,email,created_at,updated_at)
  values(v_user,'authenticated','fx-'||v_code||'@navilo.test',now(),now());
  insert into public.user_profiles(id,user_id,email,role,platform_role,is_active)
  values(v_user,v_user,'fx-'||v_code||'@navilo.test','admin','user',true);
  insert into public.companies(name,code,status,base_currency_code)
  values('FX rehearsal','FX'||v_code,'active','EUR') returning id into v_company;
  insert into public.companies(name,code,status,base_currency_code)
  values('Other FX rehearsal','FY'||v_code,'active','EUR') returning id into v_other;
  select id into strict v_unit from public.business_units where company_id=v_company and is_default;
  insert into public.company_memberships(company_id,user_id,role,is_active)
  values(v_company,v_user,'company_owner',true);
  insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active)
  values(v_company,v_unit,v_user,'company_owner',true)
  on conflict(business_unit_id,user_id) do update set role='company_owner',is_active=true;
  insert into public.business_unit_modules(business_unit_id,company_id,module_key,enabled)
  values(v_unit,v_company,'accounting',true)
  on conflict(business_unit_id,module_key) do update set enabled=true;
  insert into public.operating_locations(company_id,business_unit_id,code,name,location_type,is_active)
  values(v_company,v_unit,'FX-BR','FX branch','branch',true) returning id into v_location;
  insert into public.operating_location_memberships
    (company_id,business_unit_id,operating_location_id,user_id,role,is_active)
  values(v_company,v_unit,v_location,v_user,'company_owner',true);
  update public.user_profiles set last_company_id=v_company,last_business_unit_id=v_unit where id=v_user;
  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform public.initialize_default_coa();
  select account_id into strict v_account from public.account_mappings
    where company_id=v_company and mapping_key='accounts_receivable';

  insert into public.company_exchange_rates(company_id,foreign_currency_code,base_currency_code,effective_on,rate,source)
  values(v_company,'USD','EUR',current_date,0.91,'rehearsal'),
        (v_company,'USD','EUR',current_date+2,0.93,'rehearsal'),
        (v_other,'USD','EUR',current_date,9.99,'other company');
  if public.company_exchange_rate_on(v_company,'USD',current_date+1)<>0.91 or
     public.company_exchange_rate_on(v_company,'USD',current_date+2)<>0.93 or
     public.company_exchange_rate_on(v_company,'EUR',current_date)<>1 or
     public.company_exchange_rate_on(v_company,'GBP',current_date) is not null or
     public.company_exchange_rate_on(v_other,'USD',current_date) is not null then
    raise exception 'Effective date, base currency or tenant FX isolation failed';
  end if;

  insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,
    entry_no,entry_date,description,status)
  values(v_user,v_company,v_unit,v_location,'FX-BASE-'||v_code,current_date,'Base test','draft')
  returning id into v_base_entry;
  select currency_code,exchange_rate into v_base,v_rate from public.journal_entries where id=v_base_entry;
  if v_base<>'EUR' or v_rate<>1 then raise exception 'New journal ignored company base currency'; end if;

  insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,
    entry_no,entry_date,description,status,currency_code)
  values(v_user,v_company,v_unit,v_location,'FX-USD-'||v_code,current_date,'Foreign test','draft','USD')
  returning id into v_entry;
  insert into public.journal_lines(user_id,company_id,entry_id,account,account_id,debit,credit)
  select v_user,v_company,v_entry,name,id,100,0 from public.chart_of_accounts where id=v_account;
  select base_debit into v_debit from public.journal_lines where entry_id=v_entry;
  if v_debit<>91 then raise exception 'Foreign debit conversion failed: %',v_debit; end if;

  v_failed:=false;
  begin
    update public.journal_entries set entry_date=current_date+2 where id=v_entry;
  exception when others then v_failed:=true; end;
  if not v_failed then raise exception 'Draft FX date changed after lines were booked'; end if;

  insert into public.company_exchange_rates(company_id,foreign_currency_code,base_currency_code,effective_on,rate,source)
  values(v_company,'USD','EUR',current_date,0.95,'later correction');
  select exchange_rate into v_rate from public.journal_entries where id=v_entry;
  if v_rate<>0.91 or public.company_exchange_rate_on(v_company,'USD',current_date)<>0.95 then
    raise exception 'Journal rate snapshot changed after rate history was appended';
  end if;
  insert into public.journal_lines(user_id,company_id,entry_id,account,account_id,debit,credit)
  select v_user,v_company,v_entry,name,id,0,100 from public.chart_of_accounts where id=v_account;
  v_failed:=false;
  begin
    update public.journal_entries set status='posted' where id=v_entry;
  exception when others then v_failed:=true; end;
  if not v_failed then raise exception 'Foreign journal posted into an unconverted ledger'; end if;
  select exchange_rate into v_rate from public.journal_entries where id=v_entry;
  if v_rate<>0.91 or (select status from public.journal_entries where id=v_entry)<>'draft' then
    raise exception 'Rejected foreign posting changed the draft snapshot';
  end if;
  insert into public.journal_lines(user_id,company_id,entry_id,account,account_id,debit,credit)
  select v_user,v_company,v_base_entry,name,id,100,0 from public.chart_of_accounts where id=v_account;
  insert into public.journal_lines(user_id,company_id,entry_id,account,account_id,debit,credit)
  select v_user,v_company,v_base_entry,name,id,0,100 from public.chart_of_accounts where id=v_account;
  update public.journal_entries set status='posted' where id=v_base_entry;
  v_failed:=false;
  begin
    update public.journal_entries set exchange_rate=0.95 where id=v_base_entry;
  exception when others then v_failed:=true; end;
  if not v_failed then raise exception 'Posted base journal exchange rate was mutable'; end if;
  v_failed:=false;
  begin
    insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,
      entry_no,entry_date,status,currency_code)
    values(v_user,v_company,v_unit,v_location,'FX-MISSING-'||v_code,current_date,'draft','GBP');
  exception when others then v_failed:=true; end;
  if not v_failed then raise exception 'Missing FX rate did not fail closed'; end if;
  raise notice 'PASS: company base, dated tenant FX, immutable snapshots and unsafe posting blocked';
end $$;
rollback;
