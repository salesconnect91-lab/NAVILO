begin;

-- These columns and constraints exist in the read-only production catalog and
-- are consumed by the sales posting core, but their provider was missing from
-- a clean repository replay.
alter table public.sales_order_charges
  add column if not exists charge_type text not null default 'recovery',
  add column if not exists cost_amount numeric(14,2) not null default 0,
  add column if not exists cost_account_id uuid
    references public.chart_of_accounts(id);

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.sales_order_charges'::regclass
      and conname = 'sales_order_charges_charge_type_check'
  ) then
    alter table public.sales_order_charges
      add constraint sales_order_charges_charge_type_check
      check (charge_type in ('recovery', 'cost'));
  end if;
end;
$migration$;

-- post_journal_entry already selects the journal's stored owner into
-- v_user_id.  Requiring legacy_data_user_id() in the same lookup incorrectly
-- hides a valid company-owned journal from a non-owner accounts user.  Scope
-- the lookup by company, BU and active branch, then retain the stored owner for
-- every downstream line/account/ledger check.
do $migration$
declare
  v_oid oid;
  v_definition text;
  v_repaired text;
  v_old_guard constant text :=
    'AND je.user_id = public.legacy_data_user_id() AND je.company_id = public.current_company_id() AND je.business_unit_id = public.current_business_unit_id()';
  v_new_guard constant text :=
    'AND je.company_id = public.current_company_id()
    AND je.business_unit_id = public.current_business_unit_id()
    AND je.operating_location_id = public.current_operating_location_id()';
begin
  select p.oid
    into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'post_journal_entry'
    and pg_get_function_identity_arguments(p.oid) = 'p_entry_id uuid';

  if v_oid is null then
    raise exception 'post_journal_entry(uuid) is missing';
  end if;

  v_definition := pg_get_functiondef(v_oid);

  if position(v_new_guard in v_definition) > 0
     and position(v_old_guard in v_definition) = 0 then
    return;
  end if;

  v_repaired := replace(v_definition, v_old_guard, v_new_guard);
  if v_repaired = v_definition then
    raise exception 'post_journal_entry tenant-owner patch pattern did not match';
  end if;

  execute v_repaired;
end;
$migration$;

revoke all on function public.post_journal_entry(uuid) from public, anon;
grant execute on function public.post_journal_entry(uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
