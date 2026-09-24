begin;

-- ============================================================
-- 1. Stock rows must identify an item + warehouse + godown
-- ============================================================

alter table public.warehouse_stock
  alter column item_id set not null,
  alter column warehouse_id set not null,
  alter column godown_id set not null;

alter table public.stock_movements
  alter column item_id set not null,
  alter column warehouse_id set not null,
  alter column godown_id set not null;

-- ============================================================
-- 2. Quantity integrity
-- ============================================================

alter table public.warehouse_stock
  drop constraint if exists warehouse_stock_quantity_nonnegative;

alter table public.warehouse_stock
  add constraint warehouse_stock_quantity_nonnegative
  check (quantity >= 0);

alter table public.stock_movements
  drop constraint if exists stock_movements_qty_positive;

alter table public.stock_movements
  add constraint stock_movements_qty_positive
  check (qty >= 0);

-- ============================================================
-- 3. Harden transfer_stock_v2
-- ============================================================

create or replace function public.transfer_stock_v2(
  p_item_id uuid,
  p_warehouse_id uuid,
  p_from_godown_id uuid,
  p_to_godown_id uuid,
  p_qty numeric,
  p_reference text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_from_stock_id uuid;
  v_to_stock_id uuid;
  v_from_qty numeric := 0;
  v_from_name text;
  v_to_name text;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;

  if p_item_id is null then
    raise exception 'Item is required.';
  end if;

  if p_warehouse_id is null then
    raise exception 'Warehouse is required.';
  end if;

  if p_from_godown_id is null or p_to_godown_id is null then
    raise exception 'Source and destination godown are required.';
  end if;

  if p_from_godown_id = p_to_godown_id then
    raise exception 'Source and destination godown cannot be the same.';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'Transfer quantity must be greater than zero.';
  end if;

  if not exists (
    select 1
    from public.items
    where id = p_item_id
  ) then
    raise exception 'Selected item does not exist.';
  end if;

  if not exists (
    select 1
    from public.warehouses
    where id = p_warehouse_id
  ) then
    raise exception 'Selected warehouse does not exist.';
  end if;

  select name
    into v_from_name
  from public.godowns
  where id = p_from_godown_id
    and warehouse_id = p_warehouse_id;

  if v_from_name is null then
    raise exception
      'Source godown does not belong to selected warehouse.';
  end if;

  select name
    into v_to_name
  from public.godowns
  where id = p_to_godown_id
    and warehouse_id = p_warehouse_id;

  if v_to_name is null then
    raise exception
      'Destination godown does not belong to selected warehouse.';
  end if;

  -- Serialize this user's item/warehouse transfer.
  perform pg_advisory_xact_lock(
    hashtextextended(
      v_user_id::text || ':' ||
      p_item_id::text || ':' ||
      p_warehouse_id::text,
      0
    )
  );

  select id, coalesce(quantity, 0)
    into v_from_stock_id, v_from_qty
  from public.warehouse_stock
  where user_id = v_user_id
    and item_id = p_item_id
    and warehouse_id = p_warehouse_id
    and godown_id = p_from_godown_id
  limit 1
  for update;

  v_from_qty := coalesce(v_from_qty, 0);

  if v_from_stock_id is null or p_qty > v_from_qty then
    raise exception
      'Insufficient stock. Available in %: %, Required: %.',
      v_from_name,
      v_from_qty,
      p_qty;
  end if;

  update public.warehouse_stock
  set
    quantity = quantity - p_qty,
    updated_at = now(),
    godown = v_from_name
  where id = v_from_stock_id
    and user_id = v_user_id;

  select id
    into v_to_stock_id
  from public.warehouse_stock
  where user_id = v_user_id
    and item_id = p_item_id
    and warehouse_id = p_warehouse_id
    and godown_id = p_to_godown_id
  limit 1
  for update;

  if v_to_stock_id is null then
    insert into public.warehouse_stock (
      user_id,
      item_id,
      warehouse_id,
      godown_id,
      godown,
      quantity,
      updated_at
    )
    values (
      v_user_id,
      p_item_id,
      p_warehouse_id,
      p_to_godown_id,
      v_to_name,
      p_qty,
      now()
    );
  else
    update public.warehouse_stock
    set
      quantity = quantity + p_qty,
      updated_at = now(),
      godown = v_to_name
    where id = v_to_stock_id
      and user_id = v_user_id;
  end if;

  insert into public.stock_movements (
    user_id,
    item_id,
    warehouse_id,
    godown_id,
    godown,
    type,
    qty,
    reference
  )
  values
  (
    v_user_id,
    p_item_id,
    p_warehouse_id,
    p_from_godown_id,
    v_from_name,
    'out',
    p_qty,
    coalesce(nullif(btrim(p_reference), ''), 'Stock Transfer')
  ),
  (
    v_user_id,
    p_item_id,
    p_warehouse_id,
    p_to_godown_id,
    v_to_name,
    'in',
    p_qty,
    coalesce(nullif(btrim(p_reference), ''), 'Stock Transfer')
  );
end;
$function$;

revoke all on function public.transfer_stock_v2(
  uuid, uuid, uuid, uuid, numeric, text
) from public;

revoke all on function public.transfer_stock_v2(
  uuid, uuid, uuid, uuid, numeric, text
) from anon;

grant execute on function public.transfer_stock_v2(
  uuid, uuid, uuid, uuid, numeric, text
) to authenticated;

-- apply_stock_movement is created and secured by the next migration (0027).
-- ACL statements cannot precede a routine on a genuinely fresh database.

commit;
