-- PostgREST sets the impersonated database role for both legacy JWT keys and
-- modern sb_secret_* keys. The JWT claim is absent for secret keys, so use
-- the database role for existing authorization checks.

do $migration$
declare
  v_oid oid;
  v_name text;
  v_def text;
  v_new text;
begin
  for v_oid, v_name in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'assert_platform_order_import_authorized',
        'company_resource_limits',
        'enforce_active_operating_location_write_scope',
        'guard_platform_audit_log_immutability',
        'guard_stock_movement_immutability',
        'platform_import_order_book',
        'prevent_posted_purchase_order_changes',
        'prevent_posted_sales_order_changes'
      )
  loop
    v_def := pg_get_functiondef(v_oid);
    -- Retain each existing authorization predicate and change its setting
    -- source. Exact regexes against pg_get_functiondef() are format fragile.
    v_new := replace(v_def, '''request.jwt.claim.role''', '''role''');
    if v_new = v_def then
      -- Several functions on a fresh install already call auth.role().
      -- Leave those existing guards intact instead of failing the replay.
      continue;
    end if;
    execute v_new;
  end loop;
end
$migration$;

-- Keep destructive maintenance RPCs backend-only.
do $migration$
begin
  -- This RPC exists on some live schemas, but its defining migration is not
  -- present in the fresh local migration chain. Never create it implicitly.
  if to_regprocedure('public.platform_delete_company(uuid,uuid)') is not null then
    execute 'revoke all on function public.platform_delete_company(uuid,uuid) from public, anon, authenticated';
    execute 'grant execute on function public.platform_delete_company(uuid,uuid) to service_role';
  end if;
end
$migration$;
revoke all on function public.platform_preview_company_transaction_reset(uuid) from public, anon, authenticated;
revoke all on function public.platform_reset_company_transactions(uuid,uuid) from public, anon, authenticated;
grant execute on function public.platform_preview_company_transaction_reset(uuid) to service_role;
grant execute on function public.platform_reset_company_transactions(uuid,uuid) to service_role;
