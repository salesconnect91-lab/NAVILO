-- Additive configuration history. Existing companies retain their legacy invoice behavior
-- until an explicit tax event is recorded; no posted document is rewritten here.
create table public.company_tax_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  effective_from date not null,
  tax_mode text not null check (tax_mode in ('non_tax','tax_registered')),
  authority_code text,
  registration_number text,
  details jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (company_id,effective_from),
  check (tax_mode = 'non_tax' or nullif(trim(authority_code),'') is not null)
);
create index company_tax_events_effective_idx on public.company_tax_events(company_id,effective_from desc);
alter table public.company_tax_events enable row level security;
create policy company_tax_events_read on public.company_tax_events for select to authenticated
  using (company_id = public.current_company_id() and public.has_company_access(company_id) or public.is_platform_owner());
create policy company_tax_events_admin_insert on public.company_tax_events for insert to authenticated
  with check (company_id = public.current_company_id() and public.has_company_access(company_id)
    and public.has_module_permission(company_id,'settings','edit'));
revoke all on public.company_tax_events from public,anon;
grant select,insert on public.company_tax_events to authenticated;

-- Tax events are append-only and must not backdate a company's posted history.
create function public.guard_company_tax_event() returns trigger language plpgsql
security definer set search_path=public,pg_temp as $$
begin
  if new.effective_from < current_date then raise exception 'Tax transitions cannot be backdated'; end if;
  if exists (select 1 from public.company_tax_events e
             where e.company_id=new.company_id and e.effective_from>=new.effective_from) then
    raise exception 'A later tax configuration already exists';
  end if;
  new.created_by:=coalesce(auth.uid(),new.created_by);
  return new;
end$$;
revoke all on function public.guard_company_tax_event() from public,anon,authenticated;
create trigger company_tax_event_insert before insert on public.company_tax_events
for each row execute function public.guard_company_tax_event();

create function public.company_tax_mode_on(p_company_id uuid,p_on date) returns text
language sql stable security definer set search_path=public,pg_temp as $$
  select case when public.is_platform_owner() or
    (p_company_id=public.current_company_id() and public.has_company_access(p_company_id))
    then coalesce((select e.tax_mode from public.company_tax_events e
      where e.company_id=p_company_id and e.effective_from<=p_on
      order by e.effective_from desc limit 1),'legacy')
    else null end;
$$;
revoke all on function public.company_tax_mode_on(uuid,date) from public,anon;
grant execute on function public.company_tax_mode_on(uuid,date) to authenticated;

create table public.currency_master (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  name text not null,
  minor_units smallint not null check (minor_units between 0 and 4),
  is_active boolean not null default true
);
insert into public.currency_master(code,name,minor_units) values
  ('PKR','Pakistani Rupee',2),('USD','US Dollar',2),('EUR','Euro',2),
  ('GBP','Pound Sterling',2),('SAR','Saudi Riyal',2),('AED','UAE Dirham',2);
alter table public.currency_master enable row level security;
create policy currency_master_read on public.currency_master for select to authenticated using (true);
revoke all on public.currency_master from public,anon;
grant select on public.currency_master to authenticated;

alter table public.companies add column base_currency_code text not null default 'PKR'
  references public.currency_master(code);

create table public.company_exchange_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  foreign_currency_code text not null references public.currency_master(code),
  base_currency_code text not null references public.currency_master(code),
  effective_on date not null,
  rate numeric(24,10) not null check (rate>0),
  source text not null,
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  check (foreign_currency_code<>base_currency_code)
);
create index company_exchange_rates_lookup_idx on public.company_exchange_rates
  (company_id,foreign_currency_code,effective_on desc,recorded_at desc);
alter table public.company_exchange_rates enable row level security;
create policy company_exchange_rates_read on public.company_exchange_rates for select to authenticated
  using (company_id=public.current_company_id() and public.has_company_access(company_id) or public.is_platform_owner());
create policy company_exchange_rates_admin_insert on public.company_exchange_rates for insert to authenticated
  with check (company_id=public.current_company_id() and public.has_company_access(company_id)
    and public.has_module_permission(company_id,'accounting','edit'));
revoke all on public.company_exchange_rates from public,anon;
grant select,insert on public.company_exchange_rates to authenticated;

create function public.guard_company_exchange_rate() returns trigger language plpgsql
security definer set search_path=public,pg_temp as $$
declare v_base text;
begin
  select base_currency_code into v_base from public.companies where id=new.company_id;
  if v_base is null or new.base_currency_code<>v_base then raise exception 'Exchange rate base currency does not match company'; end if;
  new.recorded_by:=coalesce(auth.uid(),new.recorded_by);
  return new;
end$$;
revoke all on function public.guard_company_exchange_rate() from public,anon,authenticated;
create trigger company_exchange_rate_insert before insert on public.company_exchange_rates
for each row execute function public.guard_company_exchange_rate();

-- Base currency cannot change after any posted journal; posted FX snapshots stay intact.
create function public.guard_company_base_currency() returns trigger language plpgsql
security definer set search_path=public,pg_temp as $$
begin
  if new.base_currency_code is distinct from old.base_currency_code and
     (exists(select 1 from public.journal_entries j where j.company_id=old.id and j.status='posted')
      or exists(select 1 from public.company_exchange_rates r where r.company_id=old.id)) then
    raise exception 'Base currency cannot change after posting or recording exchange rates; use a controlled migration';
  end if;
  return new;
end$$;
revoke all on function public.guard_company_base_currency() from public,anon,authenticated;
create trigger company_base_currency_change before update of base_currency_code on public.companies
for each row execute function public.guard_company_base_currency();
