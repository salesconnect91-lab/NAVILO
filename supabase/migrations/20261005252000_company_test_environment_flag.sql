alter table public.companies add column if not exists is_test_company boolean not null default false;
comment on column public.companies.is_test_company is 'Platform-owner controlled marker for explicitly designated test companies.';
