-- Synced from verified production migration 20261006195759 (skip_trip_audit_capture_during_test_reset).
create or replace function public.transport_trip_audit_capture()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if coalesce(current_setting('app.maintenance_reset',true),'0')='1' then return case when tg_op='DELETE' then old else new end; end if;
 if tg_op='UPDATE' and new is not distinct from old then return new;end if;
 insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,event_type,old_data,new_data,changed_by)
 values(coalesce(new.company_id,old.company_id),coalesce(new.business_unit_id,old.business_unit_id),coalesce(new.id,old.id),lower(tg_op),case when tg_op='INSERT' then null else to_jsonb(old) end,case when tg_op='DELETE' then null else to_jsonb(new) end,auth.uid());
 return coalesce(new,old);
end $$;
