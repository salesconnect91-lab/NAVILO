select set_config('app.maintenance_reset','1',true);

do $$
declare
  t text;
  tx_tables text[] := array[
    'sales_orders','sales_order_lines','sales_order_charges','sales_order_hawala_invoices',
    'sales_consolidations','sales_consolidation_invoices','consolidated_sales_invoices',
    'consolidated_sales_invoice_lines','consolidated_sales_invoice_charges',
    'purchase_orders','purchase_order_lines','purchase_order_consolidated_invoices',
    'consolidated_purchase_invoices','consolidated_purchase_invoice_lines','consolidated_purchase_invoice_charges',
    'work_orders','work_order_lines','furnace_yields','cutting_orders','gate_passes',
    'stock_movements','warehouse_stock','inventory_costs','hawala_pending_stock',
    'journal_entries','journal_lines','ledgers','party_ledgers',
    'invoice_payment_allocations','purchase_payment_allocations',
    'return_notes','return_note_lines','bank_reconciliations','bank_reconciliation_items',
    'fiscal_year_closures','fiscal_year_opening_balances','opening_balance_batches',
    'account_budgets','fixed_assets','fixed_asset_depreciation'
  ];
begin
  foreach t in array tx_tables loop
    if to_regclass('public.'||t) is not null then
      execute format('alter table public.%I add column if not exists business_unit_id uuid', t);
    end if;
  end loop;
end $$;

create or replace function public.stamp_business_unit_context()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_unit uuid;
begin
  if coalesce(current_setting('app.maintenance_reset', true),'0')='1' then return new; end if;
  if tg_op='UPDATE' and old.business_unit_id is not null and new.business_unit_id is distinct from old.business_unit_id then
    raise exception 'Business unit cannot be changed after transaction creation.';
  end if;
  v_unit:=coalesce(new.business_unit_id,public.current_business_unit_id());
  if v_unit is null and new.company_id is not null then
    select b.id into v_unit from public.business_units b where b.company_id=new.company_id and b.is_active order by b.is_default desc,b.created_at asc limit 1;
  end if;
  if v_unit is null then raise exception 'No active business unit selected.'; end if;
  if not exists(select 1 from public.business_units b where b.id=v_unit and b.company_id=new.company_id and b.is_active) then
    raise exception 'Business unit does not belong to the active company.';
  end if;
  new.business_unit_id:=v_unit;
  return new;
end;
$function$;
revoke all on function public.stamp_business_unit_context() from public,anon,authenticated;

do $$
declare
  t text;
  tx_tables text[] := array[
    'sales_orders','sales_order_lines','sales_order_charges','sales_order_hawala_invoices',
    'sales_consolidations','sales_consolidation_invoices','consolidated_sales_invoices',
    'consolidated_sales_invoice_lines','consolidated_sales_invoice_charges',
    'purchase_orders','purchase_order_lines','purchase_order_consolidated_invoices',
    'consolidated_purchase_invoices','consolidated_purchase_invoice_lines','consolidated_purchase_invoice_charges',
    'work_orders','work_order_lines','furnace_yields','cutting_orders','gate_passes',
    'stock_movements','warehouse_stock','inventory_costs','hawala_pending_stock',
    'journal_entries','journal_lines','ledgers','party_ledgers',
    'invoice_payment_allocations','purchase_payment_allocations',
    'return_notes','return_note_lines','bank_reconciliations','bank_reconciliation_items',
    'fiscal_year_closures','fiscal_year_opening_balances','opening_balance_batches',
    'account_budgets','fixed_assets','fixed_asset_depreciation'
  ];
  cname text;
begin
  foreach t in array tx_tables loop
    if to_regclass('public.'||t) is not null then
      execute format('update public.%I x set business_unit_id=(select bu.id from public.business_units bu where bu.company_id=x.company_id and bu.is_active order by bu.is_default desc,bu.created_at asc limit 1) where x.business_unit_id is null',t);
      cname:=t||'_business_unit_id_fkey';
      if not exists(select 1 from pg_constraint where conname=cname and conrelid=to_regclass('public.'||t)) then
        execute format('alter table public.%I add constraint %I foreign key (business_unit_id) references public.business_units(id) on delete restrict',t,cname);
      end if;
      execute format('alter table public.%I alter column business_unit_id set default public.current_business_unit_id()',t);
      execute format('alter table public.%I alter column business_unit_id set not null',t);
      execute format('create index if not exists %I on public.%I(company_id,business_unit_id)',t||'_company_business_unit_idx',t);
      execute format('drop trigger if exists trg_stamp_business_unit on public.%I',t);
      execute format('create trigger trg_stamp_business_unit before insert or update on public.%I for each row execute function public.stamp_business_unit_context()',t);
      execute format('drop policy if exists business_unit_scope on public.%I',t);
      execute format('create policy business_unit_scope on public.%I as restrictive for all to authenticated using (business_unit_id=public.current_business_unit_id()) with check (business_unit_id=public.current_business_unit_id())',t);
    end if;
  end loop;
end $$;

create or replace function public.assign_user_to_business_unit(p_business_unit_id uuid,p_user_id uuid,p_role text default 'viewer',p_is_active boolean default true)
returns uuid language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare v_company uuid; v_id uuid;
begin
  if not public.is_platform_owner() then raise exception 'Platform owner access required.'; end if;
  select company_id into v_company from public.business_units where id=p_business_unit_id;
  if v_company is null then raise exception 'Business unit not found.'; end if;
  if not exists(select 1 from public.company_memberships m where m.company_id=v_company and m.user_id=p_user_id) then raise exception 'User must belong to the company before business unit assignment.'; end if;
  insert into public.business_unit_memberships(business_unit_id,company_id,user_id,role,is_active)
  values(p_business_unit_id,v_company,p_user_id,p_role,p_is_active)
  on conflict (business_unit_id,user_id) do update set role=excluded.role,is_active=excluded.is_active,updated_at=now()
  returning id into v_id;
  return v_id;
end;$function$;

create or replace function public.remove_user_from_business_unit(p_business_unit_id uuid,p_user_id uuid)
returns boolean language plpgsql security definer set search_path to 'public','pg_temp' as $function$
begin
  if not public.is_platform_owner() then raise exception 'Platform owner access required.'; end if;
  update public.business_unit_memberships set is_active=false,updated_at=now() where business_unit_id=p_business_unit_id and user_id=p_user_id;
  return found;
end;$function$;
revoke all on function public.assign_user_to_business_unit(uuid,uuid,text,boolean) from public,anon;
revoke all on function public.remove_user_from_business_unit(uuid,uuid) from public,anon;
grant execute on function public.assign_user_to_business_unit(uuid,uuid,text,boolean) to authenticated;
grant execute on function public.remove_user_from_business_unit(uuid,uuid) to authenticated;
