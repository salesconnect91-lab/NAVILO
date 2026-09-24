-- Final advisor cleanup after the live accounting deployment.

do $block$
declare fn record;
begin
  for fn in
    select p.oid,n.nspname,p.proname,
           pg_get_function_identity_arguments(p.oid) identity_args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
  loop
    execute format('alter function %I.%I(%s) set search_path = public, pg_temp',
      fn.nspname,fn.proname,fn.identity_args);
  end loop;
end
$block$;

do $block$
begin
  if to_regclass('public.accounts') is not null then
    drop policy if exists "Allow authenticated insert on accounts" on public.accounts;
    drop policy if exists "Enable insert for authenticated users" on public.accounts;
  end if;
end
$block$;
drop policy if exists select_own_stock_movements on public.stock_movements;
drop policy if exists select_own_warehouse_stock on public.warehouse_stock;

alter table public.account_mappings
  drop constraint if exists account_mappings_user_mapping_key;

notify pgrst,'reload schema';
