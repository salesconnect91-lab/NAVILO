-- Synthetic local-only foreign manual journal, base ledger and base reversal.
begin;
do $$
declare
  v_user uuid:=gen_random_uuid(); v_company uuid; v_unit uuid; v_location uuid;
  v_entry uuid; v_cash uuid; v_ar uuid; v_customer uuid; v_reversal uuid; v_result jsonb;
  v_code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
  v_debit numeric; v_credit numeric; v_source numeric; v_base numeric; v_failed boolean;
begin
  insert into auth.users(id,role,email,created_at,updated_at)
  values(v_user,'authenticated','fx-post-'||v_code||'@navilo.test',now(),now());
  insert into public.user_profiles(id,user_id,email,role,platform_role,is_active)
  values(v_user,v_user,'fx-post-'||v_code||'@navilo.test','admin','user',true);
  insert into public.companies(name,code,status,base_currency_code)
  values('FX posting test','FP'||v_code,'active','EUR') returning id into v_company;
  select id into strict v_unit from public.business_units where company_id=v_company and is_default;
  insert into public.company_memberships(company_id,user_id,role,is_active)
  values(v_company,v_user,'company_owner',true);
  insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active)
  values(v_company,v_unit,v_user,'company_owner',true)
  on conflict(business_unit_id,user_id) do update set role='company_owner',is_active=true;
  insert into public.business_unit_modules(business_unit_id,company_id,module_key,enabled)
  values(v_unit,v_company,'accounting',true),(v_unit,v_company,'master',true)
  on conflict(business_unit_id,module_key) do update set enabled=true;
  insert into public.operating_locations(company_id,business_unit_id,code,name,location_type,is_active)
  values(v_company,v_unit,'FP-BR','FX posting branch','branch',true) returning id into v_location;
  insert into public.operating_location_memberships
    (company_id,business_unit_id,operating_location_id,user_id,role,is_active)
  values(v_company,v_unit,v_location,v_user,'company_owner',true);
  update public.user_profiles set last_company_id=v_company,last_business_unit_id=v_unit where id=v_user;
  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform public.initialize_default_coa();
  select account_id into strict v_cash from public.account_mappings
    where company_id=v_company and mapping_key='cash';
  select account_id into strict v_ar from public.account_mappings
    where company_id=v_company and mapping_key='accounts_receivable';
  insert into public.customers(user_id,company_id,name,account_id)
  values(v_user,v_company,'FX rehearsal customer',v_ar) returning id into v_customer;
  insert into public.company_exchange_rates(company_id,foreign_currency_code,base_currency_code,effective_on,rate,source)
  values(v_company,'USD','EUR',current_date,0.91,'rehearsal');

  insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,
    entry_no,entry_date,description,status,trans_type,currency_code)
  values(v_user,v_company,v_unit,v_location,'FX-POST-'||v_code,current_date,
    'Foreign customer receipt','draft','Manual Journal','USD') returning id into v_entry;
  insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,
    entry_id,account,account_id,debit,credit,party_type,party_id)
  select v_user,v_company,v_unit,v_location,v_entry,name,id,100,0,'customer',v_customer
    from public.chart_of_accounts where id=v_ar;
  insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,
    entry_id,account,account_id,debit,credit)
  select v_user,v_company,v_unit,v_location,v_entry,name,id,0,100
    from public.chart_of_accounts where id=v_cash;
  insert into public.company_exchange_rates(company_id,foreign_currency_code,base_currency_code,effective_on,rate,source)
  values(v_company,'USD','EUR',current_date,0.95,'later rate');
  v_failed:=false;
  begin
    perform public.post_journal_entry(v_entry);
  exception when others then v_failed:=true; end;
  if not v_failed then raise exception 'Direct posting of foreign amounts was allowed'; end if;
  if exists(select 1 from public.ledgers where journal_entry_id=v_entry) then
    raise exception 'Rejected foreign posting left ledger rows';
  end if;
  v_result:=public.post_foreign_manual_journal(v_entry);
  if (v_result->>'status')<>'posted' then raise exception 'Foreign manual post failed'; end if;
  select coalesce(sum(debit),0),coalesce(sum(credit),0)
    into v_debit,v_credit from public.ledgers where journal_entry_id=v_entry;
  if v_debit<>91 or v_credit<>91 then
    raise exception 'Ledger must record 91 EUR on each side, got % / %',v_debit,v_credit;
  end if;
  select coalesce(sum(debit),0),coalesce(sum(credit),0)
    into v_debit,v_credit from public.party_ledgers
    where journal_entry_id=v_entry and party_id=v_customer;
  if v_debit<>91 or v_credit<>0 then
    raise exception 'Customer subledger must record 91 EUR receivable';
  end if;
  select coalesce(sum(source_debit),0),coalesce(sum(debit),0)
    into v_source,v_base from public.journal_lines where entry_id=v_entry;
  if v_source<>100 or v_base<>91 or
     (select exchange_rate from public.journal_entries where id=v_entry)<>0.91 then
    raise exception 'Original 100 USD and 0.91 conversion snapshot were not preserved';
  end if;
  v_result:=public.reverse_manual_journal_entry(v_entry,current_date,'FX rehearsal');
  v_reversal:=(v_result->>'reversal_entry_id')::uuid;
  select coalesce(sum(debit),0),coalesce(sum(credit),0)
    into v_debit,v_credit from public.ledgers where journal_entry_id=v_reversal;
  if v_debit<>91 or v_credit<>91 or
     (select currency_code from public.journal_entries where id=v_reversal)<>'EUR' then
    raise exception 'Reversal must negate 91 EUR in base currency';
  end if;
  select coalesce(sum(debit),0),coalesce(sum(credit),0)
    into v_debit,v_credit from public.party_ledgers
    where journal_entry_id=v_reversal and party_id=v_customer;
  if v_debit<>0 or v_credit<>91 then
    raise exception 'Customer subledger reversal must negate 91 EUR';
  end if;
  raise notice 'PASS: 100 USD posts as 91 EUR in GL and customer ledger; reversal negates 91 EUR';
end $$;
rollback;
