-- NAVILO owner-only posted-record control: safe authorization/audit foundation.
-- This migration intentionally does not cancel, delete, unlock or rewrite posted evidence.
create table if not exists public.owner_posted_control_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  business_unit_id uuid not null references public.business_units(id),
  document_type text not null,
  document_id uuid not null,
  action_type text not null check (action_type in ('cancel','correct','reverse')),
  reason text not null check (length(btrim(reason)) >= 10),
  performed_by uuid not null references auth.users(id),
  reversal_document_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint owner_posted_control_document_type_nonempty check (length(btrim(document_type)) > 0)
);
create unique index if not exists owner_posted_control_one_cancel_per_document
  on public.owner_posted_control_events(company_id,business_unit_id,document_type,document_id)
  where action_type='cancel';
create index if not exists owner_posted_control_events_tenant_time_idx
  on public.owner_posted_control_events(company_id,business_unit_id,created_at desc);
alter table public.owner_posted_control_events enable row level security;
revoke all on public.owner_posted_control_events from anon, authenticated;
grant select on public.owner_posted_control_events to authenticated;
drop policy if exists owner_posted_control_owner_read on public.owner_posted_control_events;
create policy owner_posted_control_owner_read on public.owner_posted_control_events
for select to authenticated
using (
  company_id=public.current_company_id()
  and business_unit_id=public.current_business_unit_id()
  and (
    public.is_platform_owner()
    or exists (
      select 1 from public.company_memberships cm
      join public.user_profiles up on up.id=cm.user_id
      where cm.company_id=owner_posted_control_events.company_id
        and cm.user_id=auth.uid()
        and cm.role='company_owner'
        and cm.is_active=true and up.is_active=true
    )
  )
);
create or replace function public.owner_posted_control_access()
returns boolean language sql stable security definer
set search_path to 'public','pg_temp'
as $$
  select auth.uid() is not null
    and public.current_company_id() is not null
    and public.current_business_unit_id() is not null
    and (
      public.is_platform_owner()
      or exists (
        select 1 from public.company_memberships cm
        join public.user_profiles up on up.id=cm.user_id
        where cm.company_id=public.current_company_id()
          and cm.user_id=auth.uid()
          and cm.role='company_owner'
          and cm.is_active=true and up.is_active=true
      )
    );
$$;
revoke all on function public.owner_posted_control_access() from public, anon;
grant execute on function public.owner_posted_control_access() to authenticated;
comment on table public.owner_posted_control_events is
  'Append-only owner posted-record action evidence. Financial cancellation must be performed by a separately verified module-specific transactional RPC before inserting an event.';
comment on function public.owner_posted_control_access() is
  'Read-only owner authorization. Does not grant posted data modification rights.';