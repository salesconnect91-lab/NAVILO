-- Public launch must never offer maintenance resets of financial evidence.
-- Empty onboarding rollback still uses DELETE on companies; history blocks it.
create or replace function public.platform_reset_company_transactions(p_company_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $function$
begin
  raise exception 'Company transaction reset is disabled to preserve financial history. Use correcting documents or deactivate the company.';
end $function$;

create or replace function public.platform_delete_company(p_company_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $function$
begin
  raise exception 'Permanent company deletion is disabled. Suspend or close the company to preserve its history.';
end $function$;

revoke all on function public.platform_reset_company_transactions(uuid,uuid),public.platform_delete_company(uuid,uuid) from public,anon,authenticated;
grant execute on function public.platform_reset_company_transactions(uuid,uuid),public.platform_delete_company(uuid,uuid) to service_role;

create or replace function public.protect_company_financial_history()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $function$
begin
  if exists(select 1 from public.journal_entries where company_id=old.id)
    or exists(select 1 from public.ledgers where company_id=old.id)
    or exists(select 1 from public.party_ledgers where company_id=old.id)
    or exists(select 1 from public.sales_orders where company_id=old.id)
    or exists(select 1 from public.purchase_orders where company_id=old.id)
    or exists(select 1 from public.stock_movements where company_id=old.id) then
    raise exception 'Company with financial or operational evidence cannot be deleted. Suspend or close it instead.';
  end if;
  return old;
end $function$;
revoke all on function public.protect_company_financial_history() from public,anon,authenticated;
drop trigger if exists protect_company_financial_history on public.companies;
create trigger protect_company_financial_history before delete on public.companies
for each row execute function public.protect_company_financial_history();
