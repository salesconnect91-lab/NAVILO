-- ORBIT only: identify the mapped treasury accounts, preserve their identities,
-- and add a zero-opening-balance Petty Cash subaccount.
-- No posted entries, ledger balances, payment allocations or mapping IDs are changed.
do $$
declare
  v_company uuid;
  v_cash public.chart_of_accounts%rowtype;
  v_bank public.chart_of_accounts%rowtype;
  v_existing public.chart_of_accounts%rowtype;
begin
  select id into v_company from public.companies where code='ORBITUSMAN';
  -- Fresh CI databases do not contain this tenant. Skip tenant-specific data
  -- without weakening the strict mapped-account checks when ORBIT exists.
  if v_company is null then return; end if;
  select a.* into strict v_cash
  from public.account_mappings m
  join public.chart_of_accounts a on a.id=m.account_id
  where m.company_id=v_company and m.mapping_key='cash'
    and a.company_id=v_company and a.code='1110' and a.type='asset';
  select a.* into strict v_bank
  from public.account_mappings m
  join public.chart_of_accounts a on a.id=m.account_id
  where m.company_id=v_company and m.mapping_key='bank'
    and a.company_id=v_company and a.code='1120' and a.type='asset';

  if v_bank.name not in ('Bank','Al-Rajhi Bank') then
    raise exception 'Unexpected ORBIT bank account name: %',v_bank.name;
  end if;

  select * into v_existing from public.chart_of_accounts
  where company_id=v_company and (code='1111' or lower(name)='petty cash') limit 1;
  if found and (v_existing.code<>'1111' or v_existing.name<>'Petty Cash'
     or v_existing.parent_id is distinct from v_cash.id) then
    raise exception 'Petty Cash account already exists with a conflicting code or parent';
  end if;

  -- Controlled migration context for the tenant-stamp trigger; only the two
  -- explicitly scoped ORBIT master records below are affected.
  perform set_config('app.maintenance_reset','1',true);

  update public.chart_of_accounts
  set name='Al-Rajhi Bank'
  where id=v_bank.id and name is distinct from 'Al-Rajhi Bank';

  if v_existing.id is null then
    insert into public.chart_of_accounts
      (id,company_id,user_id,code,name,type,account_role,detail_type,
       parent_id,is_group,normal_balance,allow_manual_entries,is_system_account,
       is_active,description)
    values
      (gen_random_uuid(),v_company,v_cash.user_id,'1111','Petty Cash','asset',
       'general','Cash on Hand',v_cash.id,false,'debit',true,false,true,
       'ORBIT petty cash float; zero opening balance. Separate from main cash.');
  end if;
end;
$$;
