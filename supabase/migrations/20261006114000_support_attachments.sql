begin;
create table if not exists public.support_attachments(
 id uuid primary key default gen_random_uuid(),
 ticket_id uuid not null references public.support_tickets(id) on delete cascade,
 message_id uuid not null references public.support_messages(id) on delete cascade,
 company_id uuid not null references public.companies(id) on delete cascade,
 uploaded_by uuid not null references auth.users(id),
 file_name text not null,
 storage_path text not null unique,
 mime_type text,
 file_size bigint not null check(file_size between 1 and 10485760),
 created_at timestamptz not null default now()
);
create index if not exists support_attachments_message_idx on public.support_attachments(message_id);
alter table public.support_attachments enable row level security;
drop policy if exists support_attachments_read on public.support_attachments;
create policy support_attachments_read on public.support_attachments for select to authenticated using(public.is_platform_owner() or company_id in(select company_id from public.company_memberships where user_id=auth.uid() and is_active));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('support-attachments','support-attachments',false,10485760,array['image/png','image/jpeg','image/webp','application/pdf','text/plain','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists support_attachment_object_read on storage.objects;
create policy support_attachment_object_read on storage.objects for select to authenticated using(
 bucket_id='support-attachments' and exists(
  select 1 from public.support_attachments a where a.storage_path=name and
  (public.is_platform_owner() or a.company_id in(select company_id from public.company_memberships where user_id=auth.uid() and is_active))
 )
);
drop policy if exists support_attachment_object_insert on storage.objects;
create policy support_attachment_object_insert on storage.objects for insert to authenticated with check(
 bucket_id='support-attachments' and split_part(name,'/',1)=auth.uid()::text
);
drop policy if exists support_attachment_object_delete on storage.objects;
create policy support_attachment_object_delete on storage.objects for delete to authenticated using(bucket_id='support-attachments' and owner_id=auth.uid()::text);

create or replace function public.register_support_attachment(p_ticket_id uuid,p_message_id uuid,p_file_name text,p_storage_path text,p_mime_type text,p_file_size bigint)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.support_tickets%rowtype;a uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;
 select * into t from public.support_tickets where id=p_ticket_id;if not found then raise exception 'Ticket not found';end if;
 if not public.is_platform_owner() and not exists(select 1 from public.company_memberships where company_id=t.company_id and user_id=auth.uid() and is_active) then raise exception 'Access denied';end if;
 if not exists(select 1 from public.support_messages where id=p_message_id and ticket_id=t.id and sender_id=auth.uid()) then raise exception 'Attachment must belong to your message';end if;
 if p_file_size<1 or p_file_size>10485760 then raise exception 'Attachment must be 10 MB or smaller';end if;
 if split_part(p_storage_path,'/',1)<>auth.uid()::text then raise exception 'Invalid attachment path';end if;
 insert into public.support_attachments(ticket_id,message_id,company_id,uploaded_by,file_name,storage_path,mime_type,file_size)
 values(t.id,p_message_id,t.company_id,auth.uid(),left(p_file_name,255),p_storage_path,left(p_mime_type,150),p_file_size) returning id into a;return a;
end $$;
revoke all on function public.register_support_attachment(uuid,uuid,text,text,text,bigint) from public,anon;
grant execute on function public.register_support_attachment(uuid,uuid,text,text,text,bigint) to authenticated;
commit;