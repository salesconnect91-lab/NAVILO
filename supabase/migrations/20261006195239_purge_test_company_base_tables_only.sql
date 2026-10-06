-- Synced from verified production migration 20261006195239 (purge_test_company_base_tables_only).
create or replace function public.platform_purge_test_company(p_company_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_company record; r record; n bigint; pass integer:=0; progress bigint; remaining bigint; deleted bigint:=0;
begin
 perform public.navilo_require_service_role_rpc();
 select id,name,code,is_test_company into v_company from public.companies where id=p_company_id for update;
 if not found then raise exception 'Company not found'; end if;
 if not coalesce(v_company.is_test_company,false) then raise exception 'Only an explicitly marked Test Company can be purged'; end if;
 perform set_config('app.maintenance_reset','1',true);
 update public.user_profiles p set last_company_id=case when p.last_company_id=p_company_id then null else p.last_company_id end,last_business_unit_id=case when p.last_business_unit_id in(select id from public.business_units where company_id=p_company_id) then null else p.last_business_unit_id end,locked_business_unit_id=case when p.locked_business_unit_id in(select id from public.business_units where company_id=p_company_id) then null else p.locked_business_unit_id end,locked_operating_location_id=case when p.locked_operating_location_id in(select id from public.operating_locations where company_id=p_company_id) then null else p.locked_operating_location_id end,updated_at=now()
 where p.last_company_id=p_company_id or p.last_business_unit_id in(select id from public.business_units where company_id=p_company_id) or p.locked_business_unit_id in(select id from public.business_units where company_id=p_company_id) or p.locked_operating_location_id in(select id from public.operating_locations where company_id=p_company_id);
 loop
  pass:=pass+1;progress:=0;
  for r in select distinct c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name where c.table_schema='public' and c.column_name='company_id' and t.table_type='BASE TABLE' and c.table_name not in('companies','platform_audit_logs') order by c.table_name loop
   begin execute format('delete from public.%I where company_id=$1',r.table_name) using p_company_id;get diagnostics n=row_count;progress:=progress+n;deleted:=deleted+n;
   exception when foreign_key_violation or raise_exception then null;end;
  end loop;
  exit when progress=0 or pass>=20;
 end loop;
 remaining:=0;
 for r in select distinct c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name where c.table_schema='public' and c.column_name='company_id' and t.table_type='BASE TABLE' and c.table_name not in('companies','platform_audit_logs') loop
  execute format('select count(*) from public.%I where company_id=$1',r.table_name) into n using p_company_id;remaining:=remaining+n;
 end loop;
 if remaining>0 then raise exception 'Test company purge blocked by % protected/dependent row(s). No data was deleted.',remaining;end if;
 insert into public.platform_audit_logs(actor_user_id,company_id,action,target_type,target_id,details) values(p_actor_id,p_company_id,'test_company_purge','company',p_company_id,jsonb_build_object('company_name',v_company.name,'company_code',v_company.code,'deleted_rows',deleted));
 delete from public.companies where id=p_company_id;
 if found then return jsonb_build_object('success',true,'deleted_company_id',p_company_id,'company_code',v_company.code,'deleted_rows',deleted);end if;
 raise exception 'Company could not be deleted. No purge was committed.';
end $$;
revoke all on function public.platform_purge_test_company(uuid,uuid) from public,anon,authenticated;
grant execute on function public.platform_purge_test_company(uuid,uuid) to service_role;
