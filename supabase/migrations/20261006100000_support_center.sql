create table if not exists public.support_tickets(
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
 created_by uuid not null references auth.users(id), ticket_no text not null unique,
 subject text not null, category text not null check(category in('issue','help','request','suggestion')),
 priority text not null default 'normal' check(priority in('low','normal','high','urgent')),
 status text not null default 'open' check(status in('open','in_progress','waiting_for_client','resolved','closed')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), closed_at timestamptz
);
create table if not exists public.support_messages(
 id uuid primary key default gen_random_uuid(), ticket_id uuid not null references public.support_tickets(id) on delete cascade,
 company_id uuid not null references public.companies(id) on delete cascade, sender_id uuid not null references auth.users(id),
 body text not null check(length(trim(body)) between 1 and 10000), is_owner_reply boolean not null default false,
 created_at timestamptz not null default now()
);
create index if not exists support_tickets_company_status_idx on public.support_tickets(company_id,status,updated_at desc);
create index if not exists support_messages_ticket_idx on public.support_messages(ticket_id,created_at);
alter table public.support_tickets enable row level security; alter table public.support_messages enable row level security;
drop policy if exists support_tickets_read on public.support_tickets;
create policy support_tickets_read on public.support_tickets for select to authenticated using(public.is_platform_owner() or company_id in(select company_id from public.company_memberships where user_id=auth.uid() and is_active));
drop policy if exists support_messages_read on public.support_messages;
create policy support_messages_read on public.support_messages for select to authenticated using(public.is_platform_owner() or company_id in(select company_id from public.company_memberships where user_id=auth.uid() and is_active));
create or replace function public.create_support_ticket(p_subject text,p_category text,p_message text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare cid uuid; tid uuid; n text;
begin
 select last_company_id into cid from public.user_profiles where id=auth.uid();
 if cid is null or not exists(select 1 from public.company_memberships where company_id=cid and user_id=auth.uid() and is_active) then raise exception 'Active company access required'; end if;
 n:='SUP-'||to_char(clock_timestamp(),'YYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
 insert into public.support_tickets(company_id,created_by,ticket_no,subject,category) values(cid,auth.uid(),n,trim(p_subject),p_category) returning id into tid;
 insert into public.support_messages(ticket_id,company_id,sender_id,body) values(tid,cid,auth.uid(),trim(p_message));
 return tid;
end $$;
create or replace function public.reply_support_ticket(p_ticket_id uuid,p_message text,p_status text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.support_tickets%rowtype; owner boolean;
begin
 select * into t from public.support_tickets where id=p_ticket_id; if not found then raise exception 'Ticket not found'; end if;
 owner:=public.is_platform_owner();
 if not owner and not exists(select 1 from public.company_memberships where company_id=t.company_id and user_id=auth.uid() and is_active) then raise exception 'Access denied'; end if;
 if t.status='closed' then raise exception 'Closed ticket cannot be replied to'; end if;
 insert into public.support_messages(ticket_id,company_id,sender_id,body,is_owner_reply) values(t.id,t.company_id,auth.uid(),trim(p_message),owner);
 update public.support_tickets set status=coalesce(p_status,case when owner then 'waiting_for_client' else 'open' end),updated_at=now(),closed_at=case when p_status='closed' then now() else null end where id=t.id;
end $$;
revoke all on function public.create_support_ticket(text,text,text),public.reply_support_ticket(uuid,text,text) from public,anon;
grant execute on function public.create_support_ticket(text,text,text),public.reply_support_ticket(uuid,text,text) to authenticated;