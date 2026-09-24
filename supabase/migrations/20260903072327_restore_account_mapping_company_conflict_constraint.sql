begin;

drop index if exists public.ux_account_mappings_company_key;

alter table public.account_mappings
  drop constraint if exists account_mappings_company_key_key;

alter table public.account_mappings
  add constraint account_mappings_company_key_key
  unique (company_id, mapping_key);

commit;

notify pgrst, 'reload schema';
