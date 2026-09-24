create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  status text not null default 'active' check (status in ('trial','active','suspended','expired','closed')),
  subscription_expires_at timestamptz null,
  max_users integer not null default 10 check (max_users > 0),
  contact_email text null,
  contact_phone text null,
  address text null,
  notes text null,
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('company_owner','admin','accounts','sales','purchase','store','production','viewer')),
  is_active boolean not null default true,
  permissions jsonb not null default '{}'::jsonb,
  invited_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, user_id)
);

alter table public.user_profiles add column if not exists full_name text;
alter table public.user_profiles add column if not exists email text;
alter table public.user_profiles add column if not exists platform_role text not null default 'user';
alter table public.user_profiles add column if not exists last_company_id uuid null references public.companies(id) on delete set null;
alter table public.user_profiles drop constraint if exists user_profiles_platform_role_check;
alter table public.user_profiles add constraint user_profiles_platform_role_check check (platform_role in ('super_admin','support','user'));

create table if not exists public.platform_audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid null references auth.users(id) on delete set null,
  company_id uuid null references public.companies(id) on delete set null,
  action text not null,
  target_type text null,
  target_id text null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and p.platform_role = 'super_admin'
  );
$$;

create or replace function public.has_company_access(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_owner() or exists (
    select 1
    from public.company_memberships m
    join public.companies c on c.id = m.company_id
    join public.user_profiles p on p.id = m.user_id
    where m.user_id = auth.uid()
      and m.company_id = p_company_id
      and m.is_active = true
      and p.is_active = true
      and c.status in ('trial','active')
      and (c.subscription_expires_at is null or c.subscription_expires_at > now())
  );
$$;

create or replace function public.get_my_access_context()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'profile_active', coalesce(p.is_active, false),
    'platform_role', coalesce(p.platform_role, 'user'),
    'is_platform_owner', coalesce(p.platform_role = 'super_admin' and p.is_active, false),
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'company_id', c.id,
        'company_name', c.name,
        'company_code', c.code,
        'company_status', c.status,
        'subscription_expires_at', c.subscription_expires_at,
        'membership_role', m.role,
        'membership_active', m.is_active,
        'permissions', m.permissions,
        'access_allowed', (m.is_active and c.status in ('trial','active') and (c.subscription_expires_at is null or c.subscription_expires_at > now()))
      ) order by c.name)
      from public.company_memberships m
      join public.companies c on c.id = m.company_id
      where m.user_id = auth.uid()
    ), '[]'::jsonb)
  )
  from public.user_profiles p
  where p.id = auth.uid();
$$;

update public.user_profiles p
set platform_role = 'super_admin',
    email = coalesce(p.email, u.email),
    updated_at = now()
from auth.users u
where p.id = u.id
  and p.id = (
    select p2.id
    from public.user_profiles p2
    join auth.users u2 on u2.id = p2.id
    where p2.role = 'admin' and p2.is_active = true
    order by u2.created_at asc
    limit 1
  );

alter table public.companies enable row level security;
alter table public.company_memberships enable row level security;
alter table public.platform_audit_logs enable row level security;

create policy companies_owner_all on public.companies
for all to authenticated
using (public.is_platform_owner())
with check (public.is_platform_owner());

create policy companies_member_select on public.companies
for select to authenticated
using (public.has_company_access(id));

create policy memberships_owner_all on public.company_memberships
for all to authenticated
using (public.is_platform_owner())
with check (public.is_platform_owner());

create policy memberships_self_select on public.company_memberships
for select to authenticated
using (user_id = auth.uid());

create policy platform_audit_owner_select on public.platform_audit_logs
for select to authenticated
using (public.is_platform_owner());

grant select on public.companies to authenticated;
grant select on public.company_memberships to authenticated;
grant execute on function public.is_platform_owner() to authenticated;
grant execute on function public.has_company_access(uuid) to authenticated;
grant execute on function public.get_my_access_context() to authenticated;
