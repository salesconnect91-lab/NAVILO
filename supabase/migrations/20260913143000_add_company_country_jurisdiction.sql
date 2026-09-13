alter table public.company_settings
  add column if not exists country_code text;

alter table public.company_settings
  drop constraint if exists company_settings_country_code_check;

alter table public.company_settings
  add constraint company_settings_country_code_check
  check (country_code is null or country_code ~ '^[A-Z]{2}$');

-- Existing AMK commercial UAT tenant is Pakistan-based.
-- Use replica mode only for this controlled migration backfill so legacy tenant
-- stamping triggers do not require an interactive auth session.
set local session_replication_role = replica;
update public.company_settings
set country_code = 'PK'
where company_id = '0fc7005a-a0fe-4cf9-885a-7eaafbcf9759'
  and country_code is null;
set local session_replication_role = origin;
