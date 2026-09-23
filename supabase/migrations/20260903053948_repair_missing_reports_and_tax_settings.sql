begin;

alter table public.tax_rates
  add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.charge_rate_settings
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

alter table public.tax_rates
  alter column company_id set default public.current_company_id();
alter table public.charge_rate_settings
  alter column company_id set default public.current_company_id();

update public.tax_rates
set company_id = coalesce(company_id, public.current_company_id())
where company_id is null and public.current_company_id() is not null;

update public.charge_rate_settings
set company_id = coalesce(company_id, public.current_company_id())
where company_id is null and public.current_company_id() is not null;

create unique index if not exists uq_tax_rates_company_name
  on public.tax_rates(company_id,name)
  where company_id is not null;
create unique index if not exists uq_charge_rate_settings_company_key
  on public.charge_rate_settings(company_id,charge_key)
  where company_id is not null;

alter table public.tax_rates enable row level security;
alter table public.charge_rate_settings enable row level security;

drop policy if exists tax_rates_company_admin on public.tax_rates;
create policy tax_rates_company_admin on public.tax_rates for all to authenticated
using (
  company_id = public.current_company_id()
  and (public.is_platform_owner() or exists (
    select 1 from public.company_memberships m
    where m.company_id=tax_rates.company_id
      and m.user_id=auth.uid()
      and m.is_active
      and m.role in ('company_owner','admin')
  ))
)
with check (
  company_id = public.current_company_id()
  and (public.is_platform_owner() or exists (
    select 1 from public.company_memberships m
    where m.company_id=tax_rates.company_id
      and m.user_id=auth.uid()
      and m.is_active
      and m.role in ('company_owner','admin')
  ))
);

drop policy if exists charge_rate_settings_company_admin on public.charge_rate_settings;
create policy charge_rate_settings_company_admin on public.charge_rate_settings for all to authenticated
using (
  company_id = public.current_company_id()
  and (public.is_platform_owner() or exists (
    select 1 from public.company_memberships m
    where m.company_id=charge_rate_settings.company_id
      and m.user_id=auth.uid()
      and m.is_active
      and m.role in ('company_owner','admin')
  ))
)
with check (
  company_id = public.current_company_id()
  and (public.is_platform_owner() or exists (
    select 1 from public.company_memberships m
    where m.company_id=charge_rate_settings.company_id
      and m.user_id=auth.uid()
      and m.is_active
      and m.role in ('company_owner','admin')
  ))
);

drop trigger if exists trg_tax_rates_tenant_stamp on public.tax_rates;
create trigger trg_tax_rates_tenant_stamp
before insert or update on public.tax_rates
for each row execute function public.tenant_stamp_company_user();

drop trigger if exists trg_charge_rate_settings_tenant_stamp on public.charge_rate_settings;
create trigger trg_charge_rate_settings_tenant_stamp
before insert or update on public.charge_rate_settings
for each row execute function public.tenant_stamp_company_user();

insert into public.tenant_table_modules(table_name,module_key) values
('tax_rates','master'),('charge_rate_settings','master')
on conflict (table_name) do update set module_key=excluded.module_key;

grant select,insert,update,delete on public.tax_rates to authenticated;
grant select,insert,update,delete on public.charge_rate_settings to authenticated;

notify pgrst, 'reload schema';
commit;
