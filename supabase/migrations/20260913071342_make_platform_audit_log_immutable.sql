-- Platform audit log is append-only and written by trusted SECURITY DEFINER/service-role paths.
-- TRUNCATE is not protected by RLS, so remove all client-side mutation privileges explicitly.
revoke insert, update, delete, truncate, references, trigger on table public.platform_audit_logs from authenticated, anon;
grant select on table public.platform_audit_logs to authenticated;

-- Defense in depth for any future grant changes.
create or replace function public.guard_platform_audit_log_immutability()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')='service_role' then
    return case when tg_op='DELETE' then old else new end;
  end if;
  raise exception 'Platform audit history is immutable.';
end
$function$;
revoke all on function public.guard_platform_audit_log_immutability() from public, anon, authenticated;
drop trigger if exists zz_guard_platform_audit_log_immutability on public.platform_audit_logs;
create trigger zz_guard_platform_audit_log_immutability
before update or delete on public.platform_audit_logs
for each row execute function public.guard_platform_audit_log_immutability();
