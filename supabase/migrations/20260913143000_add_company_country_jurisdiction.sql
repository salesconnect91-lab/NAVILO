alter table public.company_settings
  add column if not exists country_code text;

alter table public.company_settings
  drop constraint if exists company_settings_country_code_check;

alter table public.company_settings
  add constraint company_settings_country_code_check
  check (country_code is null or country_code ~ '^[A-Z]{2}$');

-- Country is company configuration. Do not seed a customer-specific tenant in a generic replay.
