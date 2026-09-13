-- Stock balances and movement history are accounting/inventory subledgers.
-- Signed-in clients may read them, but all mutations must go through guarded inventory RPCs.

drop policy if exists tenant_insert_stock_movements on public.stock_movements;
drop policy if exists tenant_update_stock_movements on public.stock_movements;
drop policy if exists tenant_delete_stock_movements on public.stock_movements;

drop policy if exists tenant_insert_warehouse_stock on public.warehouse_stock;
drop policy if exists tenant_update_warehouse_stock on public.warehouse_stock;
drop policy if exists tenant_delete_warehouse_stock on public.warehouse_stock;

-- Defense in depth: prevent historical movement mutation even if a broad grant/policy is added later.
create or replace function public.guard_stock_movement_immutability()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
begin
  if coalesce(current_setting('app.maintenance_reset',true),'')='1'
     or coalesce(current_setting('request.jwt.claim.role',true),'')='service_role' then
    return case when tg_op='DELETE' then old else new end;
  end if;
  raise exception 'Posted stock movement history is immutable. Use a controlled stock adjustment or transfer correction.';
end
$function$;

revoke all on function public.guard_stock_movement_immutability() from public, anon, authenticated;
drop trigger if exists zz_guard_stock_movement_immutability on public.stock_movements;
create trigger zz_guard_stock_movement_immutability
before update or delete on public.stock_movements
for each row execute function public.guard_stock_movement_immutability();
