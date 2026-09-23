create table if not exists public.dashboard_widget_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  company_id uuid not null,
  business_unit_id uuid null,
  hidden_widgets text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists dashboard_widget_preferences_scope_uq
  on public.dashboard_widget_preferences (user_id, company_id, coalesce(business_unit_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.dashboard_widget_preferences enable row level security;

drop policy if exists dashboard_widget_preferences_select on public.dashboard_widget_preferences;
create policy dashboard_widget_preferences_select on public.dashboard_widget_preferences
for select to authenticated
using (user_id = auth.uid() and company_id = public.current_company_id());

drop policy if exists dashboard_widget_preferences_insert on public.dashboard_widget_preferences;
create policy dashboard_widget_preferences_insert on public.dashboard_widget_preferences
for insert to authenticated
with check (user_id = auth.uid() and company_id = public.current_company_id());

drop policy if exists dashboard_widget_preferences_update on public.dashboard_widget_preferences;
create policy dashboard_widget_preferences_update on public.dashboard_widget_preferences
for update to authenticated
using (user_id = auth.uid() and company_id = public.current_company_id())
with check (user_id = auth.uid() and company_id = public.current_company_id());

drop policy if exists dashboard_widget_preferences_delete on public.dashboard_widget_preferences;
create policy dashboard_widget_preferences_delete on public.dashboard_widget_preferences
for delete to authenticated
using (user_id = auth.uid() and company_id = public.current_company_id());

grant select, insert, update, delete on public.dashboard_widget_preferences to authenticated;
