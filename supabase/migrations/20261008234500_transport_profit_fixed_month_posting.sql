-- Transport fixed-percentage monthly profit appropriation
-- No retrospective changes; Custom Excel stays blocked until its formula is approved.
begin;
create table public.transport_profit_month_closings (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete restrict,
 business_unit_id uuid not null references public.business_units(id) on delete restrict,
 rule_id uuid not null references public.transport_profit_distribution_rules(id) on delete restrict,
 month date not null check(month=date_trunc('month',month)::date),
 own_fleet_profit numeric(18,2) not null check(own_fleet_profit>=0),
 twakkal_profit numeric(18,2) not null check(twakkal_profit>=0),
 total_profit numeric(18,2) generated always as (own_fleet_profit+twakkal_profit) stored,
 source_note text not null check(length(btrim(source_note)) between 12 and 2000),
 source_net_profit numeric(18,2),
 source_line_count bigint,
 source_gl_account_id uuid references public.chart_of_accounts(id) on delete restrict,
 status text not null default 'draft' check(status in ('draft','approved','posted')),
 created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(),
 approved_by uuid references auth.users(id) on delete restrict,
 approved_at timestamptz,
 posted_by uuid references auth.users(id) on delete restrict,
 posted_at timestamptz,
 journal_entry_id uuid unique references public.journal_entries(id) on delete restrict,
 unique(company_id,business_unit_id,month),
 check((status='draft' and journal_entry_id is null) or (status='approved' and approved_by is not null and journal_entry_id is null) or
       (status='posted' and approved_by is not null and journal_entry_id is not null and posted_by is not null))
);
create index transport_profit_close_scope on public.transport_profit_month_closings(company_id,business_unit_id,month desc);
alter table public.transport_profit_month_closings enable row level security;
revoke all on public.transport_profit_month_closings from public,anon,authenticated;
grant select on public.transport_profit_month_closings to authenticated;
create policy transport_profit_closings_select on public.transport_profit_month_closings
 for select to authenticated
 using(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id()
    and public.has_module_permission(company_id,'transport','view')
    and public.has_module_permission(company_id,'accounting','view')
    and (public.is_platform_owner() or exists(select 1 from public.business_unit_memberships bm where bm.company_id=transport_profit_month_closings.company_id and
        bm.business_unit_id=transport_profit_month_closings.business_unit_id and bm.user_id=auth.uid() and bm.is_active and bm.role in ('company_owner','admin'))));
-- Role and scope assertion used by all RPCs, including posting.
create function public.transport_profit_month_assert(p_action text)
returns void language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();
begin
 if auth.uid() is null or c is null or b is null then raise exception 'Active company and business unit required';end if;
 if not public.has_module_permission(c,'transport','view')
    or not public.has_module_permission(c,'accounting',case when p_action='write' then 'post' else 'view' end)
    or not public.has_module_permission(c,'settings',case when p_action='write' then 'edit' else 'view' end)
    then raise exception 'Transport/Accounting/Settings permissions required';end if;
 if not public.is_platform_owner()
   and not exists(select 1 from public.business_unit_memberships m where m.company_id=c and m.business_unit_id=b
       and m.user_id=auth.uid() and m.is_active and m.role in('company_owner','admin'))
   and not exists(select 1 from public.company_memberships m where m.company_id=c and m.user_id=auth.uid()
       and m.is_active and m.role in('company_owner','admin')) then raise exception 'Company Owner/Admin required';end if;
 if not exists(select 1 from public.business_units bu where bu.id=b and bu.company_id=c
    and bu.is_active and bu.unit_type='transport') then raise exception 'Active Transport business required';end if;
end $$;
revoke all on function public.transport_profit_month_assert(text) from public,anon;
-- Only other backend functions can invoke helper; no public EXECUTE.

create function public.transport_profit_month_source(p_month date)
returns table(net_profit numeric,line_count bigint) language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();
begin
 perform public.transport_profit_month_assert('read');
 if p_month is null or p_month<>date_trunc('month',p_month)::date then raise exception 'Month start required';end if;
 return query select coalesce(round(sum(case
     when a.type='revenue' then l.credit-l.debit
     when a.type='expense' then l.credit-l.debit
     else 0 end),2),0)::numeric, count(*)::bigint
 from public.journal_entries e
 join public.journal_lines l on l.entry_id=e.id and l.company_id=c and l.business_unit_id=b
 join public.chart_of_accounts a on a.id=l.account_id and a.company_id=c
 where e.company_id=c and e.business_unit_id=b and e.status='posted'
   and e.entry_date>=p_month and e.entry_date<(p_month+interval '1 month')::date
   and e.fiscal_year_closure_id is null
   and a.type in ('revenue','expense') and not a.is_group;
end $$;
revoke all on function public.transport_profit_month_source(date) from public,anon;
grant execute on function public.transport_profit_month_source(date) to authenticated;

-- The appropriation debits retained earnings, never P&L again.
-- This reclassifies existing recognized profit into Current Account equity; does not create new income.
create function public.transport_profit_appropriation_account()
returns uuid language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id(); a uuid; n integer;
begin
 perform public.transport_profit_month_assert('read');
 select count(*),min(id) into n,a from public.chart_of_accounts
 where company_id=c and is_active and not is_group and allow_manual_entries
 and type='equity' and lower(btrim(name))='retained earnings';
 if n<>1 then raise exception 'Exactly one active posting Retained Earnings GL required';end if;
 return a;
end $$;
revoke all on function public.transport_profit_appropriation_account() from public,anon;
grant execute on function public.transport_profit_appropriation_account() to authenticated;

-- Server-side allocations in integer cents; largest remainder with stable partner_key tie breaker.
create function public.transport_profit_allocations(p_rule uuid,p_own numeric,p_twakkal numeric)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();res jsonb;
begin
 perform public.transport_profit_month_assert('read');
 if p_own is null or p_twakkal is null or p_own<0 or p_twakkal<0
   or p_own<>round(p_own,2) or p_twakkal<>round(p_twakkal,2) or p_own+p_twakkal<=0
    then raise exception 'Positive profit with two-decimal amount required';end if;
 if not exists(select 1 from public.transport_profit_distribution_rules
    where id=p_rule and company_id=c and business_unit_id=b and method='fixed_percentage' and status='configured')
    then raise exception 'Only active business Fixed Percentage rules can allocate';end if;
 with ps as (
   select p.account_id,p.partner_name_snapshot as name,p.partner_key as key,p.percentage,a.code
   from public.transport_profit_distribution_rule_partners p join public.chart_of_accounts a
     on a.id=p.account_id and a.company_id=c
   where p.rule_id=p_rule and p.company_id=c and p.business_unit_id=b
     and a.type='equity' and lower(btrim(coalesce(a.detail_type,'')))='owners_equity'
     and a.is_active and not a.is_group and a.allow_manual_entries and lower(a.name) like '%current%'
     and lower(a.name) not like '%capital%'
 ), base as (
  select ps.*,floor((p_own*100)::numeric*percentage/100)::bigint as own_floor,
   (p_own*100)*percentage/100 - floor((p_own*100)*percentage/100) as own_frac,
   floor((p_twakkal*100)*percentage/100)::bigint as tw_floor,
   (p_twakkal*100)*percentage/100 - floor((p_twakkal*100)*percentage/100) as tw_frac
  from ps
 ), split as (
  select base.*,
   row_number() over(order by own_frac desc,key) as own_rank,
   row_number() over(order by tw_frac desc,key) as tw_rank,
   ((p_own*100)::bigint - sum(own_floor) over()) as own_extra,
   ((p_twakkal*100)::bigint - sum(tw_floor) over()) as tw_extra,
   count(*) over() as partner_count,
   sum(percentage) over() as percentage_sum
   from base
 ), line as (
  select account_id,key,name,code,percentage,partner_count,percentage_sum,
     (own_floor+case when own_rank<=own_extra then 1 else 0 end)::numeric/100 as own_amount,
     (tw_floor+case when tw_rank<=tw_extra then 1 else 0 end)::numeric/100 as tw_amount
  from split
 )
 select jsonb_agg(jsonb_build_object('account_id',account_id,'partner_key',key,'name',name,'code',code,
   'percentage',percentage,'own_fleet',own_amount,'twakkal',tw_amount,'total',own_amount+tw_amount) order by key)
 into res from line where partner_count between 2 and 20 and percentage_sum=100;
 if res is null or jsonb_array_length(res)<2 then raise exception 'Complete 100-percent linked partner GLs are required';end if;
 if round((select sum((x->>'total')::numeric) from jsonb_array_elements(res) x),2)<>p_own+p_twakkal
    then raise exception 'Allocation does not balance';end if;
 return res;
end $$;
revoke all on function public.transport_profit_allocations(uuid,numeric,numeric) from public,anon;
grant execute on function public.transport_profit_allocations(uuid,numeric,numeric) to authenticated;

create function public.transport_profit_month_status(p_month date)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();
 r public.transport_profit_distribution_rules%rowtype;
 m public.transport_profit_month_closings%rowtype;
 net numeric:=0;cnt bigint:=0;gl uuid;allocation jsonb:=null;
begin
 perform public.transport_profit_month_assert('read');
 if p_month is null or p_month<>date_trunc('month',p_month)::date then raise exception 'Month start required';end if;
 select * into r from public.transport_profit_distribution_rules where company_id=c and business_unit_id=b
 and effective_from<=p_month order by effective_from desc limit 1;
 select * into m from public.transport_profit_month_closings where company_id=c and business_unit_id=b and month=p_month;
 select s.net_profit,s.line_count into net,cnt from public.transport_profit_month_source(p_month) s;
 gl:=public.transport_profit_appropriation_account();
 if m.id is not null then allocation:=public.transport_profit_allocations(m.rule_id,m.own_fleet_profit,m.twakkal_profit);end if;
 return jsonb_build_object('month',p_month,'rule_id',r.id,'method',r.method,'record',case when m.id is null then null else
    jsonb_build_object('id',m.id,'status',m.status,'own_fleet_profit',m.own_fleet_profit,'twakkal_profit',m.twakkal_profit,
    'total_profit',m.total_profit,'source_note',m.source_note,'source_net_profit',m.source_net_profit,
    'approved_by',m.approved_by,'approved_at',m.approved_at,'journal_entry_id',m.journal_entry_id,
    'posted_at',m.posted_at,'created_by',m.created_by) end,
    'posted_net_profit',net,'posted_source_lines',cnt,'source_gl_account_id',gl,'allocations',allocation,
    'month_ended',p_month<date_trunc('month',current_date)::date,'posting_enabled',r.method='fixed_percentage');
end $$;
revoke all on function public.transport_profit_month_status(date) from public,anon;
grant execute on function public.transport_profit_month_status(date) to authenticated;

create function public.transport_profit_month_save_draft(p_month date,p_own numeric,p_twakkal numeric,p_source_note text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();r public.transport_profit_distribution_rules%rowtype;rid uuid;
begin
 perform public.transport_profit_month_assert('write');
 if p_month is null or p_month<>date_trunc('month',p_month)::date then raise exception 'Valid month required';end if;
 if p_month>=date_trunc('month',current_date)::date then raise exception 'Month must finish before monthly profit can be posted';end if;
 if p_own is null or p_twakkal is null or p_own<0 or p_twakkal<0 or p_own+p_twakkal<=0 or
 p_own<>round(p_own,2) or p_twakkal<>round(p_twakkal,2) then raise exception 'Positive two-decimal profit required';end if;
 if length(btrim(coalesce(p_source_note,''))) not between 12 and 2000 then raise exception 'Provide reconciliation evidence or reference (12–2000 characters)';end if;
 select * into r from public.transport_profit_distribution_rules where company_id=c and business_unit_id=b
 and effective_from<=p_month order by effective_from desc limit 1;
 if r.id is null or r.method<>'fixed_percentage' then raise exception 'Fixed Percentage rule with linked Current GLs required';end if;
 perform public.transport_profit_allocations(r.id,p_own,p_twakkal);
 perform public.transport_profit_appropriation_account();
 if exists(select 1 from public.accounting_periods ap where ap.company_id=c and ap.status='closed' and
  (p_month+interval '1 month - 1 day')::date between ap.period_start and ap.period_end) then
   raise exception 'Accounting period is closed';end if;
 -- Protected by unique company/BU/month and row locking for editable drafts.
 perform pg_advisory_xact_lock(hashtextextended('transport-profit:'||c||':'||b||':'||p_month,0));
 insert into public.transport_profit_month_closings
  (company_id,business_unit_id,rule_id,month,own_fleet_profit,twakkal_profit,source_note,status,created_by)
 values (c,b,r.id,p_month,round(p_own,2),round(p_twakkal,2),btrim(p_source_note),'draft',auth.uid())
 on conflict (company_id,business_unit_id,month) do update set
  rule_id=excluded.rule_id,own_fleet_profit=excluded.own_fleet_profit,twakkal_profit=excluded.twakkal_profit,
  source_note=excluded.source_note,source_net_profit=null,source_line_count=null,source_gl_account_id=null
 where transport_profit_month_closings.status='draft'
 returning id into rid;
 if rid is null then raise exception 'Approved/posted month is locked and cannot be overwritten';end if;
 return rid;
end $$;
revoke all on function public.transport_profit_month_save_draft(date,numeric,numeric,text) from public,anon;
grant execute on function public.transport_profit_month_save_draft(date,numeric,numeric,text) to authenticated;

create function public.transport_profit_month_approve(p_month date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();
 m public.transport_profit_month_closings%rowtype;r public.transport_profit_distribution_rules%rowtype;
 net numeric;cnt bigint;gl uuid;items jsonb;
begin
 perform public.transport_profit_month_assert('write');
 select * into m from public.transport_profit_month_closings where company_id=c and business_unit_id=b and month=p_month for update;
 if m.id is null or m.status<>'draft' then raise exception 'Only a saved draft can be approved';end if;
 if p_month>=date_trunc('month',current_date)::date then raise exception 'Cannot approve before month ends';end if;
 select * into r from public.transport_profit_distribution_rules where company_id=c and business_unit_id=b
  and effective_from<=p_month order by effective_from desc limit 1;
 if r.id is distinct from m.rule_id or r.method<>'fixed_percentage' then raise exception 'Applicable fixed rule changed';end if;
 items:=public.transport_profit_allocations(m.rule_id,m.own_fleet_profit,m.twakkal_profit);
 gl:=public.transport_profit_appropriation_account();
 select s.net_profit,s.line_count into net,cnt from public.transport_profit_month_source(p_month) s;
 if cnt=0 or net<=0 or m.total_profit>net then
    raise exception 'Reviewed distribution exceeds posted monthly P&L or no posted P&L evidence exists (available %, requested %)',net,m.total_profit;end if;
 if exists(select 1 from public.accounting_periods ap where ap.company_id=c and ap.status='closed'
 and (p_month+interval '1 month - 1 day')::date between ap.period_start and ap.period_end) then raise exception 'Accounting period closed';end if;
 update public.transport_profit_month_closings set status='approved',approved_by=auth.uid(),approved_at=now(),
   source_net_profit=net,source_line_count=cnt,source_gl_account_id=gl where id=m.id;
 return jsonb_build_object('status','approved','month',p_month,'posted_net_profit',net,'approved_profit',m.total_profit,'allocation',items);
end $$;
revoke all on function public.transport_profit_month_approve(date) from public,anon;
grant execute on function public.transport_profit_month_approve(date) to authenticated;

create function public.transport_profit_month_post(p_month date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();u uuid:=public.legacy_data_user_id();
 m public.transport_profit_month_closings%rowtype;gl uuid;source_name text;
 amount numeric;net numeric;cnt bigint;items jsonb;item jsonb;je uuid:=gen_random_uuid();
 jno text;currency text;post_result jsonb;lines integer:=0;
begin
 perform public.transport_profit_month_assert('write');
 -- One row-level lock serializes retries; the existing approved snapshot is the sole source.
 select * into m from public.transport_profit_month_closings
 where company_id=c and business_unit_id=b and month=p_month for update;
 if m.id is null or m.status<>'approved' then raise exception 'Only approved, unposted month can be posted';end if;
 if p_month>=date_trunc('month',current_date)::date then raise exception 'Month not closed';end if;
 if u is null then raise exception 'Canonical accounting owner is missing';end if;
 gl:=public.transport_profit_appropriation_account();
 if gl is distinct from m.source_gl_account_id then raise exception 'Appropriation GL changed after approval';end if;
 select a.name into source_name from public.chart_of_accounts a where a.id=gl and a.company_id=c and a.is_active
  and a.type='equity' and a.allow_manual_entries and not a.is_group;
 if source_name is null then raise exception 'Appropriation GL missing';end if;
 select s.net_profit,s.line_count into net,cnt from public.transport_profit_month_source(p_month) s;
 if cnt is distinct from m.source_line_count or net is distinct from m.source_net_profit or net<m.total_profit
    then raise exception 'Posted P&L changed after approval; reconcile and reapprove before posting';end if;
 if exists(select 1 from public.accounting_periods ap where ap.company_id=c and ap.status='closed'
 and (p_month+interval '1 month - 1 day')::date between ap.period_start and ap.period_end)
 then raise exception 'Accounting period closed';end if;
 items:=public.transport_profit_allocations(m.rule_id,m.own_fleet_profit,m.twakkal_profit);
 if exists(select 1 from jsonb_array_elements(items) x where (x->>'account_id')::uuid=gl) then raise exception 'Appropriation GL is also a partner GL';end if;
 select base_currency_code into currency from public.companies where id=c;
 if currency is null then raise exception 'Company base currency is missing';end if;
 jno:='TPD-'||to_char(p_month,'YYYYMM')||'-'||left(replace(m.id::text,'-',''),8);
 insert into public.journal_entries(id,user_id,company_id,business_unit_id,entry_no,entry_date,
   description,status,payment_mode,trans_type,created_by,source_module,source_document_type,source_document_id,
   currency_code,exchange_rate)
 values(je,u,c,b,jno,(p_month+interval '1 month - 1 day')::date,
   'Transport monthly approved profit appropriation '||to_char(p_month,'YYYY-MM'),'draft','Accrual',
   'Transport Profit Distribution',auth.uid(),'transport','profit_distribution',m.id,currency,1);
 insert into public.journal_lines (user_id,company_id,business_unit_id,entry_id,account,account_id,debit,credit)
 values(u,c,b,je,source_name,gl,m.total_profit,0);
 for item in select value from jsonb_array_elements(items) loop
   amount:=(item->>'total')::numeric;
   if amount>0 then
    insert into public.journal_lines (user_id,company_id,business_unit_id,entry_id,account,account_id,debit,credit)
      values(u,c,b,je,item->>'name',(item->>'account_id')::uuid,0,amount);
    lines:=lines+1;
   end if;
 end loop;
 if lines<1 then raise exception 'No positive partner allocations';end if;
 -- NAVILO's canonical ledger write + balanced journal + posting guards.
 post_result:=public.post_journal_entry(je);
 if (post_result->>'status') is distinct from 'posted' then raise exception 'Canonical posting did not complete';end if;
 update public.transport_profit_month_closings set status='posted',posted_by=auth.uid(),posted_at=now(),journal_entry_id=je
 where id=m.id and status='approved';
 if not found then raise exception 'Closing lock failed';end if;
 return jsonb_build_object('status','posted','journal_entry_id',je,'journal_number',jno,'total',m.total_profit,
   'allocations',items,'accounting_result',post_result);
end $$;
revoke all on function public.transport_profit_month_post(date) from public,anon;
grant execute on function public.transport_profit_month_post(date) to authenticated;
-- No direct table mutations by end users; no Custom Excel financial posting.
commit;
