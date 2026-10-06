begin;
alter table public.support_tickets add column if not exists client_last_read_at timestamptz;
alter table public.support_tickets add column if not exists owner_last_read_at timestamptz;

create or replace function public.support_unread_summary()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();own boolean:=public.is_platform_owner();answer jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 if own then
  select jsonb_build_object('count',count(*),'tickets',count(distinct ticket_id)) into answer
  from public.support_messages m join public.support_tickets t on t.id=m.ticket_id
  where not m.is_owner_reply and m.sender_id<>auth.uid() and m.created_at>coalesce(t.owner_last_read_at,'epoch'::timestamptz);
 else
  if c is null or not exists(select 1 from public.company_memberships cm where cm.company_id=c and cm.user_id=auth.uid() and cm.is_active) then raise exception 'Active company access required';end if;
  select jsonb_build_object('count',count(*),'tickets',count(distinct ticket_id)) into answer
  from public.support_messages m join public.support_tickets t on t.id=m.ticket_id
  where t.company_id=c and m.is_owner_reply and m.created_at>coalesce(t.client_last_read_at,'epoch'::timestamptz);
 end if;
 return coalesce(answer,'{"count":0,"tickets":0}'::jsonb);
end $$;

create or replace function public.mark_support_ticket_read(p_ticket_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.support_tickets%rowtype;own boolean:=public.is_platform_owner();
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select * into t from public.support_tickets where id=p_ticket_id;if not found then raise exception 'Ticket not found';end if;
 if not own and not exists(select 1 from public.company_memberships cm where cm.company_id=t.company_id and cm.user_id=auth.uid() and cm.is_active) then raise exception 'Access denied';end if;
 if own then update public.support_tickets set owner_last_read_at=now() where id=p_ticket_id;
 else update public.support_tickets set client_last_read_at=now() where id=p_ticket_id;end if;
end $$;

revoke all on function public.support_unread_summary(),public.mark_support_ticket_read(uuid) from public,anon;
grant execute on function public.support_unread_summary(),public.mark_support_ticket_read(uuid) to authenticated;
notify pgrst,'reload schema';
commit;