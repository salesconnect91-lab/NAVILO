begin;
create or replace function public.create_support_ticket_v2(p_subject text,p_category text,p_message text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cid uuid;tid uuid;mid uuid;n text;
begin
 select last_company_id into cid from public.user_profiles where id=auth.uid();
 if cid is null or not exists(select 1 from public.company_memberships where company_id=cid and user_id=auth.uid() and is_active) then raise exception 'Active company access required';end if;
 n:='SUP-'||to_char(clock_timestamp(),'YYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
 insert into public.support_tickets(company_id,created_by,ticket_no,subject,category) values(cid,auth.uid(),n,trim(p_subject),p_category) returning id into tid;
 insert into public.support_messages(ticket_id,company_id,sender_id,body) values(tid,cid,auth.uid(),trim(p_message)) returning id into mid;
 return jsonb_build_object('ticket_id',tid,'message_id',mid);
end $$;
create or replace function public.reply_support_ticket_v2(p_ticket_id uuid,p_message text,p_status text default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.support_tickets%rowtype;own boolean;mid uuid;
begin
 select * into t from public.support_tickets where id=p_ticket_id;if not found then raise exception 'Ticket not found';end if;
 own:=public.is_platform_owner();
 if not own and not exists(select 1 from public.company_memberships where company_id=t.company_id and user_id=auth.uid() and is_active) then raise exception 'Access denied';end if;
 if t.status='closed' then raise exception 'Closed ticket cannot be replied to';end if;
 insert into public.support_messages(ticket_id,company_id,sender_id,body,is_owner_reply) values(t.id,t.company_id,auth.uid(),trim(p_message),own) returning id into mid;
 update public.support_tickets set status=coalesce(p_status,case when own then 'waiting_for_client' else 'open' end),updated_at=now(),closed_at=case when p_status='closed' then now() else null end where id=t.id;
 return mid;
end $$;
revoke all on function public.create_support_ticket_v2(text,text,text),public.reply_support_ticket_v2(uuid,text,text) from public,anon;
grant execute on function public.create_support_ticket_v2(text,text,text),public.reply_support_ticket_v2(uuid,text,text) to authenticated;
commit;