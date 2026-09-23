-- Restore legacy print-language compatibility required by the later global-language migration.
-- The original production migration also replaced the Urdu backfill RPC; that RPC is
-- already supplied by the existing Urdu foundation and later hardened migrations.
alter table public.company_settings
  add column if not exists print_language text not null default 'both';
alter table public.company_settings
  drop constraint if exists company_settings_print_language_check;
alter table public.company_settings
  add constraint company_settings_print_language_check
  check (print_language in ('english','urdu','both'));
