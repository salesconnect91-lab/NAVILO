-- Synced from verified production migration 20261006075342 (fix_test_company_purge_base_table_discovery).
create or replace function public.platform_preview_test_company_purge(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_company record; v_counts jsonb='{}'::jsonb; v_total bigint=0; r record; n bigint;
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
 select id,name,code,is_test_company into v_company from public.companies where id=p_company_id;
 if not found then raise exception 'Company not found'; end if;
 if not coalesce(v_company.is_test_company,false) then raise exception 'Only an explicitly marked Test Company can be purged'; end if;
 for r in select distinct c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE' where c.table_schema='public' and c.column_name='company_id' and c.table_name<>'platform_audit_logs' order by c.table_name loop
  execute format('select count(*) from public.%I where company_id=$1',r.table_name) into n using p_company_id;
  if n>0 then v_counts:=v_counts||jsonb_build_object(r.table_name,n); v_total:=v_total+n; end if;
 end loop;
 return jsonb_build_object('company',jsonb_build_object('id',v_company.id,'name',v_company.name,'code',v_company.code),'is_test_company',true,'total_rows',v_total,'counts',v_counts,'preserved',jsonb_build_array('Global NAVILO login/auth users','Platform audit history'));
end $$;

create or replace function public.platform_purge_test_company(p_company_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_company record; r record; n bigint; pass integer:=0; progress bigint; remaining bigint:=0; deleted bigint:=0;
begin
 if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'Service role required'; end if;
 select id,name,code,is_test_company into v_company from public.companies where id=p_company_id for update;
 if not found then raise exception 'Company not found'; end if;
 if not coalesce(v_company.is_test_company,false) then raise exception 'Only an explicitly marked Test Company can be purged'; end if;
 perform set_config('app.maintenance_reset','1',true);
 loop
  pass:=pass+1; progress:=0;
  for r in select distinct c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE' where c.table_schema='public' and c.column_name='company_id' and c.table_name not in ('companies','platform_audit_logs') order by c.table_name loop
   begin execute format('delete from public.%I where company_id=$1',r.table_name) using p_company_id; get diagnostics n=row_count; progress:=progress+n; deleted:=deleted+n;
   exception when foreign_key_violation or raise_exception then null; end;
  end loop;
  exit when progress=0 or pass>=20;
 end loop;
 for r in select distinct c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE' where c.table_schema='public' and c.column_name='company_id' and c.table_name not in ('companies','platform_audit_logs') loop
  execute format('select count(*) from public.%I where company_id=$1',r.table_name) into n using p_company_id; remaining:=remaining+n;
 end loop;
 if remaining>0 then raise exception 'Test company purge blocked by % protected/dependent row(s). No data was deleted.',remaining; end if;
 insert into public.platform_audit_logs(actor_user_id,company_id,action,target_type,target_id,details) values(p_actor_id,p_company_id,'test_company_purge','company',p_company_id,jsonb_build_object('company_name',v_company.name,'company_code',v_company.code,'deleted_rows',deleted));
 delete from public.companies where id=p_company_id;
 if found then return jsonb_build_object('success',true,'deleted_company_id',p_company_id,'company_code',v_company.code,'deleted_rows',deleted); end if;
 raise exception 'Company could not be deleted. No purge was committed.';
end $$;
