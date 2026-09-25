-- Normalize backend-role detection for both legacy JWT service_role keys and
-- modern Supabase sb_secret_* keys. PostgREST exposes the impersonated database
-- role through the standard "role" setting; JWT claims are not guaranteed for
-- the modern non-JWT secret key format.

create or replace function public.navilo_request_role()
returns text
language sql
stable
security invoker
set search_path to 'public','pg_temp'
as $$
  select coalesce(
    nullif(current_setting('role', true), ''),
    nullif(current_setting('request.jwt.claim.role', true), ''),
    ''
  )
$$;

revoke all on function public.navilo_request_role() from public, anon;
grant execute on function public.navilo_request_role() to authenticated, service_role;

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
    v_new := regexp_replace(
      v_def,
      $pattern$coalesce[[:space:]]*\([[:space:]]*current_setting[[:space:]]*\([[:space:]]*'request\.jwt\.claim\.role'[[:space:]]*,[[:space:]]*true[[:space:]]*\)[[:space:]]*,[[:space:]]*''[[:space:]]*\)$pattern$,
      'public.navilo_request_role()',
      'gi'
    );
    if v_new = v_def then
      raise exception 'Legacy request.jwt.claim.role check was not found in %', v_name;
    end if;
    execute v_new;
  end loop;
end
$migration$;

-- Keep destructive maintenance RPCs backend-only.
revoke all on function public.platform_delete_company(uuid,uuid) from public, anon, authenticated;
revoke all on function public.platform_preview_company_transaction_reset(uuid) from public, anon, authenticated;
revoke all on function public.platform_reset_company_transactions(uuid,uuid) from public, anon, authenticated;
grant execute on function public.platform_delete_company(uuid,uuid) to service_role;
grant execute on function public.platform_preview_company_transaction_reset(uuid) to service_role;
grant execute on function public.platform_reset_company_transactions(uuid,uuid) to service_role;
