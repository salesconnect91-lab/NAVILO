-- Repair legacy supplier AP links without weakening journal posting guards.
-- Uses each supplier's own tenant/user canonical Accounts Payable mapping.
create or replace function public.repair_legacy_supplier_ap_mappings()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer;
begin
  if session_user <> 'postgres' then raise exception 'Migration-only function'; end if;
  update public.suppliers s
  set account_id=am.account_id
  from public.account_mappings am
  join public.chart_of_accounts coa on coa.id=am.account_id
  where s.account_id is null
    and am.user_id=s.user_id and am.company_id=s.company_id
    and am.mapping_key='accounts_payable'
    and coa.user_id=s.user_id and coa.company_id=s.company_id
    and coa.type='liability' and coa.is_active and not coa.is_group;
  get diagnostics n=row_count;
  return n;
end $$;
select public.repair_legacy_supplier_ap_mappings();
drop function public.repair_legacy_supplier_ap_mappings();