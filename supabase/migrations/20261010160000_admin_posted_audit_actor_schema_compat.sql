-- Keep immutable posted-action audit logging compatible with historical audit_logs
-- schemas (performed_by was uuid in older migrations and text in production).
-- This changes only the audit writer, not any posted financial evidence.
create or replace function public.log_admin_posted_action(
  p_company_id uuid, p_module text, p_table_name text, p_record_id uuid,
  p_record_name text, p_action text, p_reason text,
  p_old_data jsonb default null, p_new_data jsonb default null
) returns uuid language plpgsql security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_id uuid;
  v_email text;
  v_actor_type text;
  v_metadata jsonb;
begin
  perform public.assert_admin_posted_record_control(p_company_id);
  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    raise exception 'A correction reason is required.';
  end if;
  if auth.uid() is null then
    raise exception 'Authenticated actor required for posted-record audit.';
  end if;
  select email into v_email from auth.users where id=auth.uid();
  select data_type into v_actor_type
  from information_schema.columns
  where table_schema='public' and table_name='audit_logs'
    and column_name='performed_by';
  v_metadata:=jsonb_build_object('company_id',p_company_id,'reason',p_reason,
    'posted_record_control',true,'history_preserved',true);
  if v_actor_type='uuid' then
    insert into public.audit_logs(
      action,module,record_name,performed_by,user_id,table_name,record_id,
      performed_email,old_data,new_data,metadata
    ) values(
      p_action,p_module,p_record_name,auth.uid(),auth.uid(),p_table_name,p_record_id,
      v_email,p_old_data,p_new_data,v_metadata
    ) returning id into v_id;
  elsif v_actor_type in ('text','character varying') then
    insert into public.audit_logs(
      action,module,record_name,performed_by,user_id,table_name,record_id,
      performed_email,old_data,new_data,metadata
    ) values(
      p_action,p_module,p_record_name,coalesce(v_email,auth.uid()::text),auth.uid(),
      p_table_name,p_record_id,v_email,p_old_data,p_new_data,v_metadata
    ) returning id into v_id;
  else
    raise exception 'Unsupported audit actor column type: %',coalesce(v_actor_type,'missing');
  end if;
  return v_id;
end;
$$;
