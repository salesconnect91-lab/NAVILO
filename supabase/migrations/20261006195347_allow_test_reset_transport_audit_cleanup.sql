-- Synced from verified production migration 20261006195347 (allow_test_reset_transport_audit_cleanup).
create or replace function public.transport_audit_guard()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if coalesce(current_setting('app.maintenance_reset',true),'0')='1' then return case when tg_op='DELETE' then old else new end; end if;
 raise exception 'Transport audit is append only';
end $$;
