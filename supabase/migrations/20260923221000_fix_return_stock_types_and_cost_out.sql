begin;

-- Return movements are first-class immutable stock history types.
alter table public.stock_movements drop constraint if exists stock_movements_type_check;
alter table public.stock_movements
  add constraint stock_movements_type_check
  check (type in ('in','out','adjust','purchase_return','sale_return'));

-- Purchase returns remove stock at the original purchase cost. Recalculate the
-- remaining weighted-average cost inside the active company/business unit.
create or replace function public.apply_inventory_cost_out_at_cost(
  p_item_id uuid,
  p_old_qty numeric,
  p_out_qty numeric,
  p_out_unit_cost numeric
)
returns numeric
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_user_id uuid := public.legacy_data_user_id();
  v_company_id uuid := public.current_company_id();
  v_unit_id uuid := public.current_business_unit_id();
  v_old_cost numeric;
  v_new_qty numeric;
  v_new_cost numeric;
begin
  perform public.assert_module_permission('inventory','edit');

  if v_user_id is null or v_company_id is null or v_unit_id is null then
    raise exception 'Authentication, active company and business unit are required.';
  end if;
  if p_item_id is null then raise exception 'Item is required.'; end if;
  if coalesce(p_old_qty,0) < 0 or coalesce(p_out_qty,0) <= 0
     or coalesce(p_out_unit_cost,0) < 0 or p_out_qty > p_old_qty then
    raise exception 'Invalid inventory cost-out values.';
  end if;
  if not exists (
    select 1 from public.items
    where id=p_item_id and company_id=v_company_id
  ) then raise exception 'Item not found.'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_company_id::text||':'||v_unit_id::text||':cost:'||p_item_id::text,0)
  );

  select avg_cost into v_old_cost
  from public.inventory_costs
  where user_id=v_user_id and company_id=v_company_id
    and business_unit_id=v_unit_id and item_id=p_item_id
  for update;

  if v_old_cost is null then
    select greatest(coalesce(cost,0),0) into v_old_cost
    from public.items where id=p_item_id and company_id=v_company_id;
  end if;

  v_new_qty := round(p_old_qty-p_out_qty,6);
  if v_new_qty <= 0 then
    v_new_cost := 0;
  else
    v_new_cost := greatest(
      ((p_old_qty*coalesce(v_old_cost,0))-(p_out_qty*p_out_unit_cost))/v_new_qty,
      0
    );
  end if;
  v_new_cost := round(coalesce(v_new_cost,0),6);

  insert into public.inventory_costs(
    user_id,company_id,business_unit_id,item_id,avg_cost,updated_at
  ) values (
    v_user_id,v_company_id,v_unit_id,p_item_id,v_new_cost,now()
  )
  on conflict (company_id,business_unit_id,item_id)
  do update set avg_cost=excluded.avg_cost,updated_at=now();

  return v_new_cost;
end;
$function$;

revoke all on function public.apply_inventory_cost_out_at_cost(uuid,numeric,numeric,numeric)
  from public,anon,authenticated;
grant execute on function public.apply_inventory_cost_out_at_cost(uuid,numeric,numeric,numeric)
  to service_role;

notify pgrst,'reload schema';
commit;
