create or replace function public.assert_admin_posted_record_control(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;
  if not public.is_company_admin(p_company_id) then
    raise exception 'Only an authorized company administrator can correct a posted transaction.';
  end if;
end;
$$;

create or replace function public.log_admin_posted_action(
  p_company_id uuid,
  p_module text,
  p_table_name text,
  p_record_id uuid,
  p_record_name text,
  p_action text,
  p_reason text,
  p_old_data jsonb default null,
  p_new_data jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_id uuid;
  v_email text;
begin
  perform public.assert_admin_posted_record_control(p_company_id);
  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'A correction reason is required.';
  end if;
  select email into v_email from auth.users where id=auth.uid();
  insert into public.audit_logs(action,module,record_name,performed_by,user_id,table_name,record_id,performed_email,old_data,new_data,metadata)
  values(p_action,p_module,p_record_name,coalesce(v_email,auth.uid()::text),auth.uid(),p_table_name,p_record_id,v_email,p_old_data,p_new_data,
         jsonb_build_object('company_id',p_company_id,'reason',p_reason,'posted_record_control',true,'history_preserved',true))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.assert_admin_posted_record_control(uuid) from public;
revoke all on function public.log_admin_posted_action(uuid,text,text,uuid,text,text,text,jsonb,jsonb) from public;
grant execute on function public.assert_admin_posted_record_control(uuid) to authenticated;
grant execute on function public.log_admin_posted_action(uuid,text,text,uuid,text,text,text,jsonb,jsonb) to authenticated;

