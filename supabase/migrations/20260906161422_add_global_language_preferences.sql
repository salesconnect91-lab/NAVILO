alter table public.company_settings
 add column if not exists screen_language_mode text not null default 'bilingual',
 add column if not exists screen_primary_language text not null default 'en',
 add column if not exists screen_secondary_language text default 'ur',
 add column if not exists document_language_mode text not null default 'bilingual',
 add column if not exists document_primary_language text not null default 'en',
 add column if not exists document_secondary_language text default 'ur';
update public.company_settings
set screen_language_mode=case when coalesce(print_language,'both')='english' then 'single' when print_language='urdu' then 'single' else 'bilingual' end,
 screen_primary_language=case when print_language='urdu' then 'ur' else 'en' end,
 screen_secondary_language=case when coalesce(print_language,'both')='both' then 'ur' else null end,
 document_language_mode=case when coalesce(print_language,'both')='english' then 'single' when print_language='urdu' then 'single' else 'bilingual' end,
 document_primary_language=case when print_language='urdu' then 'ur' else 'en' end,
 document_secondary_language=case when coalesce(print_language,'both')='both' then 'ur' else null end
where true;
create table if not exists public.user_language_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 use_company_default boolean not null default true,
 screen_language_mode text not null default 'bilingual',
 primary_language text not null default 'en',
 secondary_language text default 'ur',
 updated_at timestamptz not null default now(),
 constraint user_language_mode_check check (screen_language_mode in ('single','bilingual')),
 constraint user_language_secondary_check check ((screen_language_mode='single') or (secondary_language is not null and secondary_language<>primary_language))
);
alter table public.user_language_preferences enable row level security;
drop policy if exists user_language_preferences_select_own on public.user_language_preferences;
create policy user_language_preferences_select_own on public.user_language_preferences for select to authenticated using(user_id=auth.uid());
drop policy if exists user_language_preferences_insert_own on public.user_language_preferences;
create policy user_language_preferences_insert_own on public.user_language_preferences for insert to authenticated with check(user_id=auth.uid());
drop policy if exists user_language_preferences_update_own on public.user_language_preferences;
create policy user_language_preferences_update_own on public.user_language_preferences for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
grant select,insert,update on public.user_language_preferences to authenticated;