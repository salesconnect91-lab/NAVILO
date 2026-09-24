begin;

create table if not exists public.operating_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  business_unit_id uuid null references public.business_units(id) on delete restrict,
  code text not null,
  name text not null,
  location_type text not null default 'branch' check (location_type in ('branch','plant','warehouse','store','station','office','site','custom')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, code)
);

create table if not exists public.accounting_dimensions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  business_unit_id uuid null references public.business_units(id) on delete restrict,
  dimension_type text not null check (dimension_type in ('cost_center','profit_center','department','project','route','vehicle','machine','counter','tank','custom')),
  code text not null,
  name text not null,
  parent_id uuid null references public.accounting_dimensions(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, dimension_type, code)
);

create table if not exists public.company_accounting_policies (
  company_id uuid primary key references public.companies(id) on delete cascade,
  base_currency text not null default 'PKR',
  inventory_valuation_method text not null default 'weighted_average' check (inventory_valuation_method in ('weighted_average','fifo')),
  allow_negative_stock boolean not null default false,
  require_document_approval boolean not null default false,
  backdate_days integer not null default 30 check (backdate_days >= 0),
  fiscal_year_start_month integer not null default 7 check (fiscal_year_start_month between 1 and 12),
  decimal_places integer not null default 2 check (decimal_places between 0 and 6),
  enforce_period_lock boolean not null default true,
  enforce_balanced_journals boolean not null default true,
  enforce_posted_immutability boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.company_accounting_policies(company_id)
select id from public.companies
on conflict (company_id) do nothing;

create table if not exists public.document_sequences (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  business_unit_id uuid null references public.business_units(id) on delete restrict,
  document_type text not null,
  prefix text not null default '',
  next_number bigint not null default 1 check (next_number > 0),
  padding integer not null default 6 check (padding between 1 and 12),
  reset_policy text not null default 'fiscal_year' check (reset_policy in ('never','calendar_year','fiscal_year')),
  last_period_key text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists document_sequences_scope_uq on public.document_sequences(company_id, coalesce(business_unit_id,'00000000-0000-0000-0000-000000000000'::uuid), document_type);

create table if not exists public.posting_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  business_unit_id uuid null references public.business_units(id) on delete restrict,
  event_key text not null,
  name text not null,
  source_module text not null,
  is_active boolean not null default true,
  priority integer not null default 100,
  conditions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, business_unit_id, event_key, name)
);

create table if not exists public.posting_rule_lines (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.posting_rules(id) on delete cascade,
  line_no integer not null,
  side text not null check (side in ('debit','credit')),
  account_mapping_key text null,
  account_id uuid null references public.chart_of_accounts(id) on delete restrict,
  amount_expression text not null default 'amount',
  party_role text null,
  memo_template text null,
  dimensions jsonb not null default '{}'::jsonb,
  unique(rule_id,line_no),
  check (account_mapping_key is not null or account_id is not null)
);

create table if not exists public.approval_workflows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  business_unit_id uuid null references public.business_units(id) on delete restrict,
  document_type text not null,
  name text not null,
  is_active boolean not null default true,
  conditions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,business_unit_id,document_type,name)
);

create table if not exists public.approval_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.approval_workflows(id) on delete cascade,
  step_no integer not null,
  approver_role text not null,
  min_approvals integer not null default 1 check (min_approvals > 0),
  unique(workflow_id,step_no)
);

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  business_unit_id uuid null default public.current_business_unit_id() references public.business_units(id) on delete restrict,
  workflow_id uuid null references public.approval_workflows(id) on delete restrict,
  document_type text not null,
  document_id uuid not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  requested_by uuid null default auth.uid(),
  requested_at timestamptz not null default now(),
  decided_by uuid null,
  decided_at timestamptz null,
  decision_notes text null,
  unique(company_id,business_unit_id,document_type,document_id)
);

create table if not exists public.currency_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  rate_date date not null,
  from_currency text not null,
  to_currency text not null,
  rate numeric(20,8) not null check (rate > 0),
  source text null,
  created_at timestamptz not null default now(),
  unique(company_id,rate_date,from_currency,to_currency)
);

create table if not exists public.inter_unit_account_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  from_business_unit_id uuid not null references public.business_units(id) on delete cascade,
  to_business_unit_id uuid not null references public.business_units(id) on delete cascade,
  due_from_account_id uuid not null references public.chart_of_accounts(id) on delete restrict,
  due_to_account_id uuid not null references public.chart_of_accounts(id) on delete restrict,
  is_active boolean not null default true,
  unique(company_id,from_business_unit_id,to_business_unit_id),
  check(from_business_unit_id <> to_business_unit_id)
);

create table if not exists public.transaction_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  business_unit_id uuid null default public.current_business_unit_id() references public.business_units(id) on delete restrict,
  source_module text not null,
  source_type text not null,
  source_id uuid not null,
  target_module text not null,
  target_type text not null,
  target_id uuid not null,
  relation_type text not null default 'generated',
  created_at timestamptz not null default now(),
  unique(company_id,source_type,source_id,target_type,target_id,relation_type)
);

create table if not exists public.transaction_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  business_unit_id uuid null default public.current_business_unit_id() references public.business_units(id) on delete restrict,
  source_module text not null,
  document_type text not null,
  document_id uuid not null,
  file_name text not null,
  storage_path text not null,
  mime_type text null,
  file_size bigint null check(file_size is null or file_size >= 0),
  uploaded_by uuid null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.accounting_exceptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  business_unit_id uuid null default public.current_business_unit_id() references public.business_units(id) on delete restrict,
  exception_type text not null,
  severity text not null default 'warning' check(severity in ('info','warning','error','critical')),
  source_module text null,
  source_type text null,
  source_id uuid null,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check(status in ('open','acknowledged','resolved','ignored')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz null,
  resolved_by uuid null
);

alter table public.journal_entries add column if not exists operating_location_id uuid null references public.operating_locations(id) on delete restrict;
alter table public.journal_entries add column if not exists accounting_dimension_id uuid null references public.accounting_dimensions(id) on delete restrict;
alter table public.journal_entries add column if not exists source_module text null;
alter table public.journal_entries add column if not exists source_document_type text null;
alter table public.journal_entries add column if not exists source_document_id uuid null;
alter table public.journal_entries add column if not exists currency_code text not null default 'PKR';
alter table public.journal_entries add column if not exists exchange_rate numeric(20,8) not null default 1 check(exchange_rate > 0);
alter table public.journal_entries add column if not exists approval_status text not null default 'not_required' check(approval_status in ('not_required','pending','approved','rejected'));

alter table public.journal_lines add column if not exists operating_location_id uuid null references public.operating_locations(id) on delete restrict;
alter table public.journal_lines add column if not exists accounting_dimension_id uuid null references public.accounting_dimensions(id) on delete restrict;
alter table public.journal_lines add column if not exists base_debit numeric not null default 0;
alter table public.journal_lines add column if not exists base_credit numeric not null default 0;

alter table public.tax_rates add column if not exists effective_from date null;
alter table public.tax_rates add column if not exists effective_to date null;
alter table public.tax_rates add column if not exists tax_category text not null default 'standard' check(tax_category in ('standard','zero_rated','exempt','withholding','custom'));
alter table public.tax_rates add column if not exists is_inclusive boolean not null default false;

alter table public.fixed_assets add column if not exists operating_location_id uuid null references public.operating_locations(id) on delete restrict;
alter table public.fixed_assets add column if not exists accounting_dimension_id uuid null references public.accounting_dimensions(id) on delete restrict;
alter table public.account_budgets add column if not exists accounting_dimension_id uuid null references public.accounting_dimensions(id) on delete restrict;

create or replace function public.next_document_number(p_document_type text, p_prefix text default null)
returns text
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare
  v_company uuid := public.current_company_id();
  v_unit uuid := public.current_business_unit_id();
  v_policy public.company_accounting_policies%rowtype;
  v_seq public.document_sequences%rowtype;
  v_period_key text;
  v_number bigint;
begin
  if v_company is null then raise exception 'Active company is required.'; end if;
  select * into v_policy from public.company_accounting_policies where company_id=v_company;
  if not found then insert into public.company_accounting_policies(company_id) values(v_company) returning * into v_policy; end if;
  v_period_key := case
    when coalesce((select reset_policy from public.document_sequences where company_id=v_company and business_unit_id is not distinct from v_unit and document_type=p_document_type limit 1),'fiscal_year')='calendar_year' then extract(year from current_date)::int::text
    else (case when extract(month from current_date)::int >= v_policy.fiscal_year_start_month then extract(year from current_date)::int else extract(year from current_date)::int-1 end)::text
  end;
  perform pg_advisory_xact_lock(hashtextextended(v_company::text||':'||coalesce(v_unit::text,'-')||':'||p_document_type,0));
  select * into v_seq from public.document_sequences where company_id=v_company and business_unit_id is not distinct from v_unit and document_type=p_document_type for update;
  if not found then
    insert into public.document_sequences(company_id,business_unit_id,document_type,prefix,last_period_key)
    values(v_company,v_unit,p_document_type,coalesce(p_prefix,''),v_period_key)
    returning * into v_seq;
  end if;
  if v_seq.reset_policy<>'never' and v_seq.last_period_key is distinct from v_period_key then
    update public.document_sequences set next_number=1,last_period_key=v_period_key,updated_at=now() where id=v_seq.id returning * into v_seq;
  end if;
  v_number:=v_seq.next_number;
  update public.document_sequences set next_number=next_number+1,prefix=coalesce(p_prefix,prefix),updated_at=now() where id=v_seq.id returning * into v_seq;
  return v_seq.prefix || lpad(v_number::text,v_seq.padding,'0');
end;
$$;
revoke all on function public.next_document_number(text,text) from public,anon;
grant execute on function public.next_document_number(text,text) to authenticated;

create or replace function public.enforce_journal_core_rules()
returns trigger
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare
  v_policy public.company_accounting_policies%rowtype;
  v_debit numeric;
  v_credit numeric;
  v_closed boolean;
begin
  select * into v_policy from public.company_accounting_policies where company_id=new.company_id;
  if not found then insert into public.company_accounting_policies(company_id) values(new.company_id) returning * into v_policy; end if;
  if new.status='posted' then
    if v_policy.enforce_period_lock then
      select exists(select 1 from public.accounting_periods p where p.company_id=new.company_id and p.status='closed' and new.entry_date between p.period_start and p.period_end) into v_closed;
      if v_closed then raise exception 'Accounting period is closed for %.',new.entry_date; end if;
    end if;
    if v_policy.backdate_days >= 0 and new.entry_date < current_date - v_policy.backdate_days then
      raise exception 'Posting date exceeds allowed backdating policy (% days).',v_policy.backdate_days;
    end if;
    if v_policy.enforce_balanced_journals then
      select coalesce(sum(debit),0),coalesce(sum(credit),0) into v_debit,v_credit from public.journal_lines where entry_id=new.id;
      if abs(v_debit-v_credit) >= 0.01 or (v_debit=0 and v_credit=0) then
        raise exception 'Journal entry must be balanced before posting. Debit %, Credit %.',v_debit,v_credit;
      end if;
    end if;
    if new.posted_at is null then new.posted_at:=now(); end if;
    if new.posted_by is null then new.posted_by:=auth.uid(); end if;
  end if;
  return new;
end;
$$;

drop trigger if exists zz_enforce_journal_core_rules on public.journal_entries;
create trigger zz_enforce_journal_core_rules before insert or update of status,entry_date on public.journal_entries for each row execute function public.enforce_journal_core_rules();

create or replace function public.guard_posted_journal_immutability()
returns trigger
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare v_policy public.company_accounting_policies%rowtype;
begin
  if current_setting('app.maintenance_reset',true)='1' then return coalesce(new,old); end if;
  select * into v_policy from public.company_accounting_policies where company_id=old.company_id;
  if old.status='posted' and coalesce(v_policy.enforce_posted_immutability,true) then
    if tg_op='DELETE' then raise exception 'Posted journal entries cannot be deleted; create a reversal.'; end if;
    if new.status='posted' then
      if row(old.entry_no,old.entry_date,old.description,old.company_id,old.business_unit_id,old.payment_mode,old.party_name,old.trans_type)
         is distinct from row(new.entry_no,new.entry_date,new.description,new.company_id,new.business_unit_id,new.payment_mode,new.party_name,new.trans_type) then
        raise exception 'Posted journal entries are immutable; create a reversal.';
      end if;
    end if;
  end if;
  return coalesce(new,old);
end;
$$;
drop trigger if exists zz_guard_posted_journal_immutability on public.journal_entries;
create trigger zz_guard_posted_journal_immutability before update or delete on public.journal_entries for each row execute function public.guard_posted_journal_immutability();

create or replace function public.guard_journal_line_accounting_rules()
returns trigger
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare v_status text; v_rate numeric:=1;
begin
  if coalesce(new.debit,0)<0 or coalesce(new.credit,0)<0 then raise exception 'Debit and credit cannot be negative.'; end if;
  if (coalesce(new.debit,0)>0 and coalesce(new.credit,0)>0) or (coalesce(new.debit,0)=0 and coalesce(new.credit,0)=0) then raise exception 'Each journal line must contain either debit or credit.'; end if;
  select status,exchange_rate into v_status,v_rate from public.journal_entries where id=new.entry_id;
  if v_status='posted' and current_setting('app.maintenance_reset',true)<>'1' then raise exception 'Lines of a posted journal entry cannot be changed.'; end if;
  new.base_debit:=round(coalesce(new.debit,0)*coalesce(v_rate,1),2);
  new.base_credit:=round(coalesce(new.credit,0)*coalesce(v_rate,1),2);
  return new;
end;
$$;
drop trigger if exists zz_guard_journal_line_accounting_rules on public.journal_lines;
create trigger zz_guard_journal_line_accounting_rules before insert or update on public.journal_lines for each row execute function public.guard_journal_line_accounting_rules();

create or replace function public.guard_journal_line_delete()
returns trigger
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare v_status text;
begin
  select status into v_status from public.journal_entries where id=old.entry_id;
  if v_status='posted' and current_setting('app.maintenance_reset',true)<>'1' then raise exception 'Lines of a posted journal entry cannot be deleted.'; end if;
  return old;
end;
$$;
drop trigger if exists zz_guard_journal_line_delete on public.journal_lines;
create trigger zz_guard_journal_line_delete before delete on public.journal_lines for each row execute function public.guard_journal_line_delete();

create or replace function public.get_accounting_integrity_summary()
returns table(check_key text,status text,amount numeric,details jsonb)
language sql
security definer
set search_path='public','pg_temp'
as $$
with ctx as (select public.current_company_id() company_id,public.current_business_unit_id() business_unit_id),
posted as (
 select je.id,coalesce(sum(jl.debit),0) debit,coalesce(sum(jl.credit),0) credit
 from public.journal_entries je join public.journal_lines jl on jl.entry_id=je.id,ctx
 where je.company_id=ctx.company_id and je.business_unit_id=ctx.business_unit_id and je.status='posted'
 group by je.id
),
imbal as (select count(*) cnt,coalesce(sum(abs(debit-credit)),0) diff from posted where abs(debit-credit)>=0.01),
stock as (select coalesce(sum(ws.quantity*coalesce(ic.avg_cost,0)),0) value from public.warehouse_stock ws left join public.inventory_costs ic on ic.company_id=ws.company_id and ic.business_unit_id=ws.business_unit_id and ic.item_id=ws.item_id,ctx where ws.company_id=ctx.company_id and ws.business_unit_id=ctx.business_unit_id),
orph as (select count(*) cnt from public.journal_entries je,ctx where je.company_id=ctx.company_id and je.business_unit_id=ctx.business_unit_id and je.status='posted' and not exists(select 1 from public.journal_lines jl where jl.entry_id=je.id))
select 'journal_balance',case when imbal.cnt=0 then 'ok' else 'error' end,imbal.diff,jsonb_build_object('unbalanced_entries',imbal.cnt) from imbal
union all
select 'orphan_posted_journals',case when orph.cnt=0 then 'ok' else 'error' end,orph.cnt::numeric,jsonb_build_object('count',orph.cnt) from orph
union all
select 'stock_valuation','info',stock.value,jsonb_build_object('note','Inventory valuation based on current average cost') from stock;
$$;
revoke all on function public.get_accounting_integrity_summary() from public,anon;
grant execute on function public.get_accounting_integrity_summary() to authenticated;

create or replace function public.ensure_company_core_defaults()
returns trigger
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
begin
  insert into public.company_accounting_policies(company_id) values(new.id) on conflict(company_id) do nothing;
  return new;
end;
$$;
drop trigger if exists zz_company_core_defaults on public.companies;
create trigger zz_company_core_defaults after insert on public.companies for each row execute function public.ensure_company_core_defaults();

-- RLS and grants
alter table public.operating_locations enable row level security;
alter table public.accounting_dimensions enable row level security;
alter table public.company_accounting_policies enable row level security;
alter table public.document_sequences enable row level security;
alter table public.posting_rules enable row level security;
alter table public.posting_rule_lines enable row level security;
alter table public.approval_workflows enable row level security;
alter table public.approval_steps enable row level security;
alter table public.approval_requests enable row level security;
alter table public.currency_rates enable row level security;
alter table public.inter_unit_account_mappings enable row level security;
alter table public.transaction_links enable row level security;
alter table public.transaction_attachments enable row level security;
alter table public.accounting_exceptions enable row level security;

create policy operating_locations_scope on public.operating_locations for all to authenticated using (company_id=public.current_company_id() or public.is_platform_owner()) with check (company_id=public.current_company_id() or public.is_platform_owner());
create policy accounting_dimensions_scope on public.accounting_dimensions for all to authenticated using (company_id=public.current_company_id() or public.is_platform_owner()) with check (company_id=public.current_company_id() or public.is_platform_owner());
create policy company_accounting_policies_scope on public.company_accounting_policies for all to authenticated using (company_id=public.current_company_id() or public.is_platform_owner()) with check (company_id=public.current_company_id() or public.is_platform_owner());
create policy document_sequences_scope on public.document_sequences for all to authenticated using (company_id=public.current_company_id() or public.is_platform_owner()) with check (company_id=public.current_company_id() or public.is_platform_owner());
create policy posting_rules_scope on public.posting_rules for all to authenticated using (company_id=public.current_company_id() or public.is_platform_owner()) with check (company_id=public.current_company_id() or public.is_platform_owner());
create policy posting_rule_lines_scope on public.posting_rule_lines for all to authenticated using (exists(select 1 from public.posting_rules r where r.id=rule_id and (r.company_id=public.current_company_id() or public.is_platform_owner()))) with check (exists(select 1 from public.posting_rules r where r.id=rule_id and (r.company_id=public.current_company_id() or public.is_platform_owner())));
create policy approval_workflows_scope on public.approval_workflows for all to authenticated using (company_id=public.current_company_id() or public.is_platform_owner()) with check (company_id=public.current_company_id() or public.is_platform_owner());
create policy approval_steps_scope on public.approval_steps for all to authenticated using (exists(select 1 from public.approval_workflows w where w.id=workflow_id and (w.company_id=public.current_company_id() or public.is_platform_owner()))) with check (exists(select 1 from public.approval_workflows w where w.id=workflow_id and (w.company_id=public.current_company_id() or public.is_platform_owner())));
create policy approval_requests_scope on public.approval_requests for all to authenticated using (company_id=public.current_company_id() or public.is_platform_owner()) with check (company_id=public.current_company_id() or public.is_platform_owner());
create policy currency_rates_scope on public.currency_rates for all to authenticated using (company_id=public.current_company_id() or public.is_platform_owner()) with check (company_id=public.current_company_id() or public.is_platform_owner());
create policy inter_unit_account_mappings_scope on public.inter_unit_account_mappings for all to authenticated using (company_id=public.current_company_id() or public.is_platform_owner()) with check (company_id=public.current_company_id() or public.is_platform_owner());
create policy transaction_links_scope on public.transaction_links for all to authenticated using (company_id=public.current_company_id() or public.is_platform_owner()) with check (company_id=public.current_company_id() or public.is_platform_owner());
create policy transaction_attachments_scope on public.transaction_attachments for all to authenticated using (company_id=public.current_company_id() or public.is_platform_owner()) with check (company_id=public.current_company_id() or public.is_platform_owner());
create policy accounting_exceptions_scope on public.accounting_exceptions for all to authenticated using (company_id=public.current_company_id() or public.is_platform_owner()) with check (company_id=public.current_company_id() or public.is_platform_owner());

grant select,insert,update,delete on public.operating_locations,public.accounting_dimensions,public.company_accounting_policies,public.document_sequences,public.posting_rules,public.posting_rule_lines,public.approval_workflows,public.approval_steps,public.approval_requests,public.currency_rates,public.inter_unit_account_mappings,public.transaction_links,public.transaction_attachments,public.accounting_exceptions to authenticated;

commit;