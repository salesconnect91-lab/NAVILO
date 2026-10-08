-- Forward-only configuration and manual preview ONLY; does not alter posted financial records.
begin;
create table if not exists public.transport_profit_distribution_rules (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete restrict,
 business_unit_id uuid not null references public.business_units(id) on delete restrict,
 method text not null check(method in('fixed_percentage','custom_excel')),
 effective_from date not null,
 shares jsonb not null default '[]'::jsonb,
 status text not null check(status in('configured','awaiting_excel')),
 created_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id) on delete restrict,
 constraint profit_distribution_effective_month check(effective_from=date_trunc('month',effective_from)::date),
 constraint profit_distribution_method_status check((method='fixed_percentage' and status='configured') or (method='custom_excel' and status='awaiting_excel')),
 constraint profit_distribution_shares_array check(jsonb_typeof(shares)='array'),
 constraint profit_distribution_one_revision_per_month unique(company_id,business_unit_id,effective_from)
);
create index if not exists profit_distribution_scope_date on public.transport_profit_distribution_rules(company_id,business_unit_id,effective_from desc);
alter table public.transport_profit_distribution_rules enable row level security;
revoke all on public.transport_profit_distribution_rules from public,anon,authenticated;
grant select on public.transport_profit_distribution_rules to authenticated;
create policy transport_profit_rules_read on public.transport_profit_distribution_rules
 for select to authenticated
 using (
   company_id=public.current_company_id()
   and business_unit_id=public.current_business_unit_id()
   and public.has_module_permission(company_id,'transport','view')
   and public.has_module_permission(company_id,'settings','view')
 );
create or replace function public.transport_profit_distribution_save_rule(
 p_method text,
 p_effective_from date,
 p_shares jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
 c uuid:=public.current_company_id();
 b uuid:=public.current_business_unit_id();
 p jsonb;
 partner_key text;
 partner_name text;
 pct numeric;
 total_pct numeric:=0;
 partner_count integer:=0;
 keys_seen text[]:=array[]::text[];
 ident uuid;
begin
 if auth.uid() is null or c is null or b is null then raise exception 'Active company and business unit required';end if;
 if not public.has_module_permission(c,'settings','edit') or not public.has_module_permission(c,'transport','view') then
   raise exception 'Company settings edit and Transport view permissions required';end if;
 if not public.is_platform_owner() and not exists (
   select 1 from public.business_unit_memberships bm
   where bm.company_id=c and bm.business_unit_id=b and bm.user_id=auth.uid() and bm.is_active and bm.role in ('company_owner','admin')
 ) and not exists (
   select 1 from public.company_memberships cm
   where cm.company_id=c and cm.user_id=auth.uid() and cm.is_active and cm.role in ('company_owner','admin')
 ) then raise exception 'Company Owner or Administrator approval required'; end if;
 if not exists(select 1 from public.business_units bu where bu.id=b and bu.company_id=c and bu.is_active and bu.unit_type='transport') then
   raise exception 'Profit Distribution is for a Transport business unit';end if;
 if p_effective_from is null or p_effective_from<>date_trunc('month',p_effective_from)::date then
   raise exception 'Effective date must be the first day of a month';end if;
 if p_method not in ('fixed_percentage','custom_excel') then raise exception 'Invalid distribution method';end if;
 if p_shares is null or jsonb_typeof(p_shares)<>'array' then raise exception 'Shares must be a JSON array';end if;
 if p_method='fixed_percentage' then
   for p in select value from jsonb_array_elements(p_shares) loop
     if jsonb_typeof(p)<>'object' then raise exception 'Invalid partner'; end if;
     partner_key:=lower(btrim(coalesce(p->>'key','')));
     partner_name:=btrim(coalesce(p->>'name',''));
     if partner_key!~'^[a-z0-9_-]{1,40}$' or length(partner_name) not between 1 and 120 then raise exception 'Invalid partner key or name';end if;
     if partner_key=any(keys_seen) then raise exception 'Duplicate partner key';end if;
     keys_seen:=array_append(keys_seen,partner_key);
     if coalesce(p->>'percentage','')!~'^([0-9]{1,3})(\.[0-9]{1,2})?$' then raise exception 'Invalid partner percentage';end if;
     pct:=(p->>'percentage')::numeric;
     if pct<0 or pct>100 then raise exception 'Partner percentage out of range';end if;
     total_pct:=total_pct+pct;
     partner_count:=partner_count+1;
     if partner_count>20 then raise exception 'Maximum 20 partners allowed';end if;
   end loop;
   if partner_count<2 or total_pct<>100 then raise exception 'At least two partners totaling exactly 100 percent required';end if;
 else
   if jsonb_array_length(p_shares)<>0 then raise exception 'Excel method shares must remain empty until approved formula is provided';end if;
 end if;
 if exists(select 1 from public.transport_profit_distribution_rules where company_id=c and business_unit_id=b and effective_from=p_effective_from) then
   raise exception 'A distribution rule already exists for this effective month. Use a new effective month';end if;
 insert into public.transport_profit_distribution_rules(company_id,business_unit_id,method,effective_from,shares,status,created_by)
 values(c,b,p_method,p_effective_from,p_shares,case when p_method='fixed_percentage' then 'configured' else 'awaiting_excel' end,auth.uid())
 returning id into ident;
 return ident;
end $$;
revoke all on function public.transport_profit_distribution_save_rule(text,date,jsonb) from public,anon;
grant execute on function public.transport_profit_distribution_save_rule(text,date,jsonb) to authenticated;
-- Intentionally no allocation posting RPC, no formula evaluator, no historical write.
commit;
