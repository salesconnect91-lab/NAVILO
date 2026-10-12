-- User-specific, company/BU-isolated Transport Register layout sync.
-- Presentation-only metadata: never modifies trips, financial evidence or masters.
create table if not exists public.transport_register_layout_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null,
  business_unit_id uuid not null,
  layout jsonb not null default '{"order":[],"hidden":[],"widths":{}}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transport_register_layout_preferences_pk primary key (user_id,company_id,business_unit_id),
  constraint transport_register_layout_preferences_shape_ck check (
    jsonb_typeof(layout)='object'
    and jsonb_typeof(layout->'order')='array'
    and jsonb_typeof(layout->'hidden')='array'
    and jsonb_typeof(layout->'widths')='object'
    and pg_column_size(layout) <= 16000
  )
);

alter table public.transport_register_layout_preferences enable row level security;

create policy transport_register_layout_select on public.transport_register_layout_preferences
  for select to authenticated
  using (user_id=(select auth.uid())
    and company_id=(select public.current_company_id())
    and business_unit_id=(select public.current_business_unit_id()));

create policy transport_register_layout_insert on public.transport_register_layout_preferences
  for insert to authenticated
  with check (user_id=(select auth.uid())
    and company_id=(select public.current_company_id())
    and business_unit_id=(select public.current_business_unit_id()));

create policy transport_register_layout_update on public.transport_register_layout_preferences
  for update to authenticated
  using (user_id=(select auth.uid())
    and company_id=(select public.current_company_id())
    and business_unit_id=(select public.current_business_unit_id()))
  with check (user_id=(select auth.uid())
    and company_id=(select public.current_company_id())
    and business_unit_id=(select public.current_business_unit_id()));

grant select,insert,update on public.transport_register_layout_preferences to authenticated;
revoke all on public.transport_register_layout_preferences from anon;
