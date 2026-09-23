create table if not exists public.entity_translations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  language_code text not null,
  name text,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, entity_type, entity_id, language_code)
);
create index if not exists entity_translations_lookup_idx on public.entity_translations(company_id, entity_type, entity_id, language_code);
alter table public.entity_translations enable row level security;
drop policy if exists tenant_select_entity_translations on public.entity_translations;
create policy tenant_select_entity_translations on public.entity_translations for select to authenticated using (company_id = public.current_company_id());
drop policy if exists tenant_insert_entity_translations on public.entity_translations;
create policy tenant_insert_entity_translations on public.entity_translations for insert to authenticated with check (company_id = public.current_company_id());
drop policy if exists tenant_update_entity_translations on public.entity_translations;
create policy tenant_update_entity_translations on public.entity_translations for update to authenticated using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
drop policy if exists tenant_delete_entity_translations on public.entity_translations;
create policy tenant_delete_entity_translations on public.entity_translations for delete to authenticated using (company_id = public.current_company_id());
grant select, insert, update, delete on public.entity_translations to authenticated;

-- Preserve today's English + Urdu design as the default. Existing name_urdu fields remain authoritative for Urdu during migration.
comment on table public.entity_translations is 'Language-neutral translations for master data. Legacy name_urdu columns remain supported so existing English+Urdu layouts are not broken.';

