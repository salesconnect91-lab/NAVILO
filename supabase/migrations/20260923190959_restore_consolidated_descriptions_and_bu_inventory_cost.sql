begin;

-- Restore columns present in the read-only production catalog and consumed by
-- the consolidated sales/purchase posting functions.
alter table public.consolidated_sales_invoice_lines
  add column if not exists description text;

alter table public.consolidated_purchase_invoice_lines
  add column if not exists description text;

-- A later migration changed the inventory-cost uniqueness boundary from
-- (user_id, item_id) to (company_id, business_unit_id, item_id). Restore the
-- matching tenant-aware readers/writers evidenced in the live catalog.
create or replace function public.get_inventory_avg_cost(p_item_id uuid)
returns numeric
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id uuid := public.legacy_data_user_id();
  v_company_id uuid := public.current_company_id();
  v_unit_id uuid := public.current_business_unit_id();
  v_cost numeric;
begin
  perform public.assert_module_permission('inventory', 'view');

  if v_user_id is null or v_company_id is null or v_unit_id is null then
    raise exception 'Authentication, active company and business unit are required.';
  end if;

  select ic.avg_cost
    into v_cost
  from public.inventory_costs ic
  where ic.user_id = v_user_id
    and ic.company_id = v_company_id
    and ic.business_unit_id = v_unit_id
    and ic.item_id = p_item_id;

  if v_cost is null then
    select greatest(coalesce(i.cost, 0), 0)
      into v_cost
    from public.items i
    where i.id = p_item_id
      and i.company_id = v_company_id;

    if not found then
      raise exception 'Item not found.';
    end if;
  end if;

  return round(coalesce(v_cost, 0), 6);
end;
$function$;

create or replace function public.apply_inventory_cost_in(
  p_item_id uuid,
  p_old_qty numeric,
  p_in_qty numeric,
  p_in_unit_cost numeric
)
returns numeric
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id uuid := public.legacy_data_user_id();
  v_company_id uuid := public.current_company_id();
  v_unit_id uuid := public.current_business_unit_id();
  v_old_cost numeric;
  v_new_cost numeric;
begin
  perform public.assert_module_permission('inventory', 'edit');

  if v_user_id is null or v_company_id is null or v_unit_id is null then
    raise exception 'Authentication, active company and business unit are required.';
  end if;
  if p_item_id is null then
    raise exception 'Item is required.';
  end if;
  if coalesce(p_old_qty, 0) < 0
     or coalesce(p_in_qty, 0) <= 0
     or coalesce(p_in_unit_cost, 0) < 0 then
    raise exception 'Invalid inventory costing values.';
  end if;
  if not exists (
    select 1
    from public.items
    where id = p_item_id
      and company_id = v_company_id
  ) then
    raise exception 'Item not found.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      v_company_id::text || ':' || v_unit_id::text || ':cost:' || p_item_id::text,
      0
    )
  );

  select avg_cost
    into v_old_cost
  from public.inventory_costs
  where user_id = v_user_id
    and company_id = v_company_id
    and business_unit_id = v_unit_id
    and item_id = p_item_id
  for update;

  if v_old_cost is null then
    select greatest(coalesce(cost, 0), 0)
      into v_old_cost
    from public.items
    where id = p_item_id
      and company_id = v_company_id;
  end if;

  if coalesce(p_old_qty, 0) <= 0 then
    v_new_cost := p_in_unit_cost;
  else
    v_new_cost := (
      (p_old_qty * v_old_cost) + (p_in_qty * p_in_unit_cost)
    ) / (p_old_qty + p_in_qty);
  end if;

  v_new_cost := round(coalesce(v_new_cost, 0), 6);

  insert into public.inventory_costs (
    user_id,
    company_id,
    business_unit_id,
    item_id,
    avg_cost,
    updated_at
  ) values (
    v_user_id,
    v_company_id,
    v_unit_id,
    p_item_id,
    v_new_cost,
    now()
  )
  on conflict (company_id, business_unit_id, item_id)
  do update set
    avg_cost = excluded.avg_cost,
    updated_at = now();

  return v_new_cost;
end;
$function$;

revoke all on function public.get_inventory_avg_cost(uuid)
  from public, anon, authenticated;
revoke all on function public.apply_inventory_cost_in(uuid, numeric, numeric, numeric)
  from public, anon, authenticated;

grant execute on function public.get_inventory_avg_cost(uuid) to service_role;
grant execute on function public.apply_inventory_cost_in(uuid, numeric, numeric, numeric)
  to service_role;

notify pgrst, 'reload schema';

commit;
