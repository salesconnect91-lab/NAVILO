begin;

-- One company-owned charge definition is the accounting source of truth.
alter table public.charge_master
  add column if not exists default_rate numeric(14,4) not null default 0,
  add column if not exists unit text not null default 'fixed',
  add column if not exists applies_to text not null default 'both',
  add column if not exists is_fixed boolean not null default false;

alter table public.charge_master
  alter column company_id set default public.current_company_id();

update public.charge_master cm
set default_rate = cr.rate,
    unit = cr.unit,
    applies_to = cr.applies_to,
    is_fixed = cr.is_fixed
from public.charge_rate_settings cr
where cr.company_id = cm.company_id
  and cr.charge_key = cm.charge_key;

alter table public.charge_master
  alter column company_id set not null;

alter table public.charge_master drop constraint if exists charge_master_unit_check;
alter table public.charge_master add constraint charge_master_unit_check
  check (unit in ('fixed','percent','per_kg','per_ton','per_piece'));
alter table public.charge_master drop constraint if exists charge_master_applies_to_check;
alter table public.charge_master add constraint charge_master_applies_to_check
  check (applies_to in ('sales','purchase','both'));
alter table public.charge_master drop constraint if exists charge_master_default_rate_check;
alter table public.charge_master add constraint charge_master_default_rate_check
  check (default_rate >= 0);

create unique index if not exists uq_charge_master_company_key
  on public.charge_master(company_id, charge_key);

-- Document numbers are assigned inside the INSERT transaction. Count+1 and
-- random fallbacks are not valid accounting document numbering strategies.
create or replace function public.assign_sales_order_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_company_id uuid := coalesce(new.company_id, public.current_company_id());
  v_user_id uuid := coalesce(new.user_id, public.legacy_data_user_id());
  v_prefix text;
  v_next bigint;
begin
  if v_company_id is null or v_user_id is null then
    raise exception 'Authentication and active company are required.';
  end if;
  if v_company_id <> public.current_company_id() then
    raise exception 'Sales invoice company does not match the active company.';
  end if;
  perform public.assert_module_permission('sales', 'create');

  v_prefix := case new.invoice_type
    when 'Cash Bill' then 'CSH'
    when 'Tax Invoice' then 'TAX'
    else 'INV'
  end;

  if new.order_no is null or btrim(new.order_no) = '' or new.order_no like '%-AUTO' then
    perform pg_advisory_xact_lock(hashtextextended(v_company_id::text || ':sales-order:' || v_prefix, 0));
    select coalesce(max((regexp_match(order_no, '^' || v_prefix || '-([0-9]+)$'))[1]::bigint), 0) + 1
      into v_next
    from public.sales_orders
    where company_id = v_company_id and order_no ~ ('^' || v_prefix || '-[0-9]+$');
    new.order_no := v_prefix || '-' || lpad(v_next::text, 4, '0');
  end if;

  new.company_id := v_company_id;
  new.user_id := v_user_id;
  return new;
end;
$function$;

drop trigger if exists trg_assign_sales_order_number on public.sales_orders;
create trigger trg_assign_sales_order_number
before insert on public.sales_orders
for each row execute function public.assign_sales_order_number();

create unique index if not exists uq_sales_orders_company_order_no
  on public.sales_orders(company_id, order_no);

revoke all on function public.assign_sales_order_number() from public, anon, authenticated;

-- Harden the privileged transfer engine against cross-company identifiers.
create or replace function public.transfer_stock_v2(
  p_item_id uuid, p_warehouse_id uuid, p_from_godown_id uuid,
  p_to_godown_id uuid, p_qty numeric, p_reference text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := public.legacy_data_user_id();
  v_company_id uuid := public.current_company_id();
  v_from_stock_id uuid;
  v_to_stock_id uuid;
  v_from_qty numeric := 0;
  v_from_name text;
  v_to_name text;
begin
  perform public.assert_module_permission('inventory', 'edit');
  if v_user_id is null or v_company_id is null then raise exception 'Authentication and active company are required.'; end if;
  if p_item_id is null or p_warehouse_id is null or p_from_godown_id is null or p_to_godown_id is null then raise exception 'Item, warehouse and both godowns are required.'; end if;
  if p_from_godown_id = p_to_godown_id then raise exception 'Source and destination godown cannot be the same.'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Transfer quantity must be greater than zero.'; end if;

  if not exists (select 1 from public.items where id=p_item_id and company_id=v_company_id) then raise exception 'Selected item does not belong to the active company.'; end if;
  if not exists (select 1 from public.warehouses where id=p_warehouse_id and company_id=v_company_id) then raise exception 'Selected warehouse does not belong to the active company.'; end if;
  select name into v_from_name from public.godowns where id=p_from_godown_id and warehouse_id=p_warehouse_id and company_id=v_company_id;
  select name into v_to_name from public.godowns where id=p_to_godown_id and warehouse_id=p_warehouse_id and company_id=v_company_id;
  if v_from_name is null then raise exception 'Source godown does not belong to the active company/warehouse.'; end if;
  if v_to_name is null then raise exception 'Destination godown does not belong to the active company/warehouse.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_company_id::text||':'||p_item_id::text||':'||p_warehouse_id::text,0));
  select id,coalesce(quantity,0) into v_from_stock_id,v_from_qty
  from public.warehouse_stock where company_id=v_company_id and item_id=p_item_id and warehouse_id=p_warehouse_id and godown_id=p_from_godown_id limit 1 for update;
  if v_from_stock_id is null or p_qty>coalesce(v_from_qty,0) then raise exception 'Insufficient stock. Available in %: %, Required: %.',v_from_name,coalesce(v_from_qty,0),p_qty; end if;

  update public.warehouse_stock set quantity=quantity-p_qty,updated_at=now(),godown=v_from_name
  where id=v_from_stock_id and company_id=v_company_id;
  select id into v_to_stock_id from public.warehouse_stock
  where company_id=v_company_id and item_id=p_item_id and warehouse_id=p_warehouse_id and godown_id=p_to_godown_id limit 1 for update;
  if v_to_stock_id is null then
    insert into public.warehouse_stock(user_id,company_id,item_id,warehouse_id,godown_id,godown,quantity,updated_at)
    values(v_user_id,v_company_id,p_item_id,p_warehouse_id,p_to_godown_id,v_to_name,p_qty,now());
  else
    update public.warehouse_stock set quantity=quantity+p_qty,updated_at=now(),godown=v_to_name
    where id=v_to_stock_id and company_id=v_company_id;
  end if;

  insert into public.stock_movements(user_id,company_id,item_id,warehouse_id,godown_id,godown,type,qty,reference)
  values
    (v_user_id,v_company_id,p_item_id,p_warehouse_id,p_from_godown_id,v_from_name,'out',p_qty,coalesce(nullif(btrim(p_reference),''),'Stock Transfer')),
    (v_user_id,v_company_id,p_item_id,p_warehouse_id,p_to_godown_id,v_to_name,'in',p_qty,coalesce(nullif(btrim(p_reference),''),'Stock Transfer'));
end;
$function$;

revoke all on function public.transfer_stock_v2(uuid,uuid,uuid,uuid,numeric,text) from public, anon;
grant execute on function public.transfer_stock_v2(uuid,uuid,uuid,uuid,numeric,text) to authenticated;

notify pgrst, 'reload schema';
commit;
