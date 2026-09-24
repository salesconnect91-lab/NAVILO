create table if not exists public.employees (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 employee_code text,
 name text not null,
 phone text,
 designation text,
 department text,
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists employees_user_code_unique on public.employees(user_id,employee_code) where employee_code is not null;
create index if not exists employees_user_name_idx on public.employees(user_id,lower(name));
alter table public.employees enable row level security;