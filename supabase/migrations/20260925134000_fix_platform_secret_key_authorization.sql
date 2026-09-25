-- Supabase secret API keys (sb_secret_*) are not JWTs, so request.jwt.claim.role
-- is not populated the same way as the legacy service_role JWT.
-- These privileged maintenance RPCs are already callable only by service_role.
-- Keep authorization at the Edge Function (Platform Owner check) plus PostgreSQL
-- EXECUTE grants, and remove the obsolete JWT-claim guard from the RPC bodies.

do $migration$
declare
  v_sig text;
  v_oid regprocedure;
  v_def text;
  v_new text;
begin
  foreach v_sig in array array[
    'public.platform_delete_company(uuid,uuid)',
    'public.platform_preview_company_transaction_reset(uuid)',
    'public.platform_reset_company_transactions(uuid,uuid)'
  ]
  loop
    v_oid := to_regprocedure(v_sig);
    if v_oid is null then
      -- A fresh checkout does not include the historical live-only company
      -- deletion RPC. Keep that operation unavailable until its own guarded
      -- implementation is restored; reset/preview still need this migration.
      if v_sig = 'public.platform_delete_company(uuid,uuid)' then
        continue;
      end if;
      raise exception 'Required platform maintenance function is missing: %', v_sig;
    end if;

    v_def := pg_get_functiondef(v_oid);
    -- PostgreSQL preserves the function body with varying whitespace and
    -- dollar-quote formatting. Change only the setting read by the existing
    -- service_role guard, leaving the guard and its error in place.
    v_new := replace(v_def, '''request.jwt.claim.role''', '''role''');

    if v_new = v_def then
      raise exception 'Expected legacy service-role setting was not found in %', v_sig;
    end if;

    execute v_new;
    if v_sig = 'public.platform_delete_company(uuid,uuid)' then
      execute 'revoke all on function public.platform_delete_company(uuid,uuid) from public, anon, authenticated';
      execute 'grant execute on function public.platform_delete_company(uuid,uuid) to service_role';
    end if;
  end loop;
end
$migration$;

-- Defense in depth: these SECURITY DEFINER RPCs must never be callable by
-- browser roles. The backend secret key maps to service_role.
revoke all on function public.platform_preview_company_transaction_reset(uuid) from public, anon, authenticated;
revoke all on function public.platform_reset_company_transactions(uuid,uuid) from public, anon, authenticated;

grant execute on function public.platform_preview_company_transaction_reset(uuid) to service_role;
grant execute on function public.platform_reset_company_transactions(uuid,uuid) to service_role;

comment on function public.platform_preview_company_transaction_reset(uuid) is
  'Backend-only reset preview. EXECUTE restricted to service_role; caller authorization is enforced by platform-admin Edge Function.';
comment on function public.platform_reset_company_transactions(uuid,uuid) is
  'Platform-owner transaction reset. Backend-only: EXECUTE restricted to service_role; caller authorization is enforced by platform-admin Edge Function.';
