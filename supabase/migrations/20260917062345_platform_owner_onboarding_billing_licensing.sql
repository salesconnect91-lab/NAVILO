-- Platform-owner commercial onboarding, billing ledger and licence lifecycle.
alter table public.subscription_plans
  add column if not exists currency_code text not null default 'USD',
  add column if not exists trial_days integer not null default 14,
  add column if not exists module_defaults text[] not null default array['dashboard','master','sales','purchase','inventory','accounting','reports','settings']::text[];

alter table public.subscription_plans drop constraint if exists subscription_plans_currency_chk;
alter table public.subscription_plans add constraint subscription_plans_currency_chk check (currency_code ~ '^[A-Z]{3}$');
alter table public.subscription_plans drop constraint if exists subscription_plans_trial_days_chk;
alter table public.subscription_plans add constraint subscription_plans_trial_days_chk check (trial_days between 0 and 365);

alter table public.company_subscriptions
  add column if not exists currency_code text not null default 'USD',
  add column if not exists grace_days integer not null default 7,
  add column if not exists auto_renew boolean not null default false,
  add column if not exists cancelled_at timestamptz,
  add column if not exists external_customer_ref text,
  add column if not exists external_subscription_ref text;

alter table public.company_subscriptions drop constraint if exists company_subscriptions_currency_chk;
alter table public.company_subscriptions add constraint company_subscriptions_currency_chk check (currency_code ~ '^[A-Z]{3}$');
alter table public.company_subscriptions drop constraint if exists company_subscriptions_grace_days_chk;
alter table public.company_subscriptions add constraint company_subscriptions_grace_days_chk check (grace_days between 0 and 90);

create table if not exists public.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  subscription_id uuid references public.company_subscriptions(id) on delete set null,
  invoice_number text not null,
  status text not null default 'draft' check (status in ('draft','issued','partially_paid','paid','void','overdue')),
  issue_date date not null default current_date,
  due_date date not null,
  currency_code text not null default 'USD' check (currency_code ~ '^[A-Z]{3}$'),
  subtotal numeric(18,2) not null default 0 check (subtotal >= 0),
  tax_amount numeric(18,2) not null default 0 check (tax_amount >= 0),
  total_amount numeric(18,2) generated always as (round(subtotal + tax_amount,2)) stored,
  paid_amount numeric(18,2) not null default 0 check (paid_amount >= 0),
  period_start date,
  period_end date,
  external_invoice_ref text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,invoice_number),
  check (due_date >= issue_date),
  check (period_end is null or period_start is null or period_end >= period_start)
);

create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_id uuid not null references public.subscription_invoices(id) on delete restrict,
  amount numeric(18,2) not null check (amount > 0),
  currency_code text not null default 'USD' check (currency_code ~ '^[A-Z]{3}$'),
  paid_at timestamptz not null default now(),
  method text not null default 'manual',
  reference text,
  external_payment_ref text,
  notes text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.licence_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  subscription_id uuid references public.company_subscriptions(id) on delete set null,
  event_type text not null,
  from_status text,
  to_status text,
  details jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists subscription_invoices_company_due_idx on public.subscription_invoices(company_id,due_date desc);
create index if not exists subscription_invoices_open_idx on public.subscription_invoices(company_id,due_date) where status in ('issued','partially_paid','overdue');
create index if not exists subscription_payments_invoice_paid_idx on public.subscription_payments(invoice_id,paid_at desc);
create index if not exists licence_events_company_created_idx on public.licence_events(company_id,created_at desc);

alter table public.subscription_invoices enable row level security;
alter table public.subscription_payments enable row level security;
alter table public.licence_events enable row level security;

create policy subscription_invoices_owner_all on public.subscription_invoices for all to authenticated
  using (public.is_platform_owner()) with check (public.is_platform_owner());
create policy subscription_invoices_tenant_read on public.subscription_invoices for select to authenticated
  using (company_id=public.current_company_id() and public.has_company_access(company_id));
create policy subscription_payments_owner_all on public.subscription_payments for all to authenticated
  using (public.is_platform_owner()) with check (public.is_platform_owner());
create policy subscription_payments_tenant_read on public.subscription_payments for select to authenticated
  using (company_id=public.current_company_id() and public.has_company_access(company_id));
create policy licence_events_owner_all on public.licence_events for all to authenticated
  using (public.is_platform_owner()) with check (public.is_platform_owner());
create policy licence_events_tenant_read on public.licence_events for select to authenticated
  using (company_id=public.current_company_id() and public.has_company_access(company_id));

revoke all on public.subscription_invoices,public.subscription_payments,public.licence_events from anon;
grant select,insert,update,delete on public.subscription_invoices,public.subscription_payments,public.licence_events to authenticated;
grant usage,select on sequence public.licence_events_id_seq to authenticated;

create or replace function public.refresh_subscription_invoice_totals()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_invoice uuid:=coalesce(new.invoice_id,old.invoice_id); v_total numeric; v_paid numeric;
begin
  select total_amount into v_total from public.subscription_invoices where id=v_invoice for update;
  select coalesce(sum(amount),0) into v_paid from public.subscription_payments where invoice_id=v_invoice;
  update public.subscription_invoices set paid_amount=v_paid,
    status=case when status='void' then 'void' when v_paid>=v_total and v_total>0 then 'paid' when v_paid>0 then 'partially_paid' when due_date<current_date and status<>'draft' then 'overdue' else status end,
    updated_at=now() where id=v_invoice;
  return coalesce(new,old);
end$$;
revoke all on function public.refresh_subscription_invoice_totals() from public,anon,authenticated;

drop trigger if exists trg_subscription_payment_totals on public.subscription_payments;
create trigger trg_subscription_payment_totals after insert or update or delete on public.subscription_payments
for each row execute function public.refresh_subscription_invoice_totals();

create or replace function public.sync_company_licence_from_subscription()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_company_status text;
begin
  v_company_status:=case when new.status='trial' then 'trial' when new.status='active' then 'active' else 'suspended' end;
  update public.companies set status=v_company_status,subscription_expires_at=new.expires_at,updated_at=now() where id=new.company_id;
  if tg_op='INSERT' or old.status is distinct from new.status or old.expires_at is distinct from new.expires_at then
    insert into public.licence_events(company_id,subscription_id,event_type,from_status,to_status,details,actor_id)
    values(new.company_id,new.id,case when tg_op='INSERT' then 'subscription_created' else 'subscription_changed' end,
      case when tg_op='UPDATE' then old.status else null end,new.status,
      jsonb_build_object('expires_at',new.expires_at,'billing_cycle',new.billing_cycle),auth.uid());
  end if;
  return new;
end$$;
revoke all on function public.sync_company_licence_from_subscription() from public,anon,authenticated;

drop trigger if exists trg_sync_company_licence on public.company_subscriptions;
create trigger trg_sync_company_licence after insert or update of status,expires_at on public.company_subscriptions
for each row execute function public.sync_company_licence_from_subscription();

create or replace function public.mark_overdue_subscription_invoices()
returns integer language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_count integer;
begin
  if not public.is_platform_owner() then raise exception 'Platform Owner access required'; end if;
  update public.subscription_invoices set status='overdue',updated_at=now()
  where status in ('issued','partially_paid') and due_date<current_date and paid_amount<total_amount;
  get diagnostics v_count=row_count;
  return v_count;
end$$;
revoke all on function public.mark_overdue_subscription_invoices() from public,anon;
grant execute on function public.mark_overdue_subscription_invoices() to authenticated,service_role;
