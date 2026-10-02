-- Canonical supplier/AP mapping for Transport service purchases.
-- Suppliers use the company's configured Accounts Payable control account.
create or replace function public.ensure_supplier_ap_mapping()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_ap uuid;
begin
  if new.account_id is not null then return new; end if;
  select am.account_id into v_ap
  from public.account_mappings am
  join public.chart_of_accounts coa on coa.id=am.account_id
  where am.user_id=new.user_id and am.company_id=new.company_id
    and am.mapping_key='accounts_payable'
    and coa.user_id=new.user_id and coa.company_id=new.company_id
    and coa.type='liability' and coa.is_active and not coa.is_group
  limit 1;
  if v_ap is not null then new.account_id:=v_ap; end if;
  return new;
end $$;

drop trigger if exists zzzz_supplier_ap_mapping on public.suppliers;
create trigger zzzz_supplier_ap_mapping before insert or update of account_id,user_id,company_id
on public.suppliers for each row execute function public.ensure_supplier_ap_mapping();

-- Backfill only currently-unmapped suppliers where their own tenant/user has a valid AP mapping.
update public.suppliers s
set account_id=(
 select am.account_id
 from public.account_mappings am
 join public.chart_of_accounts coa on coa.id=am.account_id
 where am.user_id=s.user_id and am.company_id=s.company_id
   and am.mapping_key='accounts_payable'
   and coa.user_id=s.user_id and coa.company_id=s.company_id
   and coa.type='liability' and coa.is_active and not coa.is_group
 limit 1
)
where s.account_id is null
and exists(
 select 1 from public.account_mappings am
 join public.chart_of_accounts coa on coa.id=am.account_id
 where am.user_id=s.user_id and am.company_id=s.company_id
 and am.mapping_key='accounts_payable' and coa.user_id=s.user_id and coa.company_id=s.company_id
 and coa.type='liability' and coa.is_active and not coa.is_group
);