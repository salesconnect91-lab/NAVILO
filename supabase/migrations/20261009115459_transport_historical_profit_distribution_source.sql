-- Correct source selection; no opening journal edits or new income recognition.
begin;
create or replace function public.transport_profit_historical_source(p_month date)
returns table(net_profit numeric,line_count bigint,account_id uuid,posting_date date)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();expected bigint;found_count bigint;account_count bigint;
begin
 perform public.transport_profit_month_assert('read');
 if p_month is null or p_month<>date_trunc('month',p_month)::date then raise exception 'Month start required';end if;
 select count(*) into expected from public.transport_vehicle_historical_profits h
 where h.company_id=c and h.business_unit_id=b and h.month=p_month;
 if expected=0 then return;end if;
 select count(*),count(distinct l.account_id) into found_count,account_count
 from public.transport_vehicle_historical_profits h
 join public.journal_lines l on l.id=h.source_journal_line_id and l.company_id=c and l.business_unit_id=b
 join public.journal_entries j on j.id=l.entry_id and j.company_id=c and j.business_unit_id=b
 join public.chart_of_accounts a on a.id=l.account_id and a.company_id=c
 where h.company_id=c and h.business_unit_id=b and h.month=p_month
 and j.status='posted' and j.source_document_type='cutover_opening_balances'
 and round(l.credit-l.debit,2)=h.net_profit
 and a.type='equity' and a.is_active and not a.is_group and a.allow_manual_entries;
 if found_count<>expected or account_count<>1 then raise exception 'Historical profit source evidence or single equity account is invalid';end if;
 -- A month with both opening NET and operating P&L needs explicit reconciliation.
 if exists(select 1 from public.journal_entries j join public.journal_lines l on l.entry_id=j.id
 join public.chart_of_accounts a on a.id=l.account_id and a.company_id=c
 where j.company_id=c and j.business_unit_id=b and l.company_id=c and l.business_unit_id=b
 and j.status='posted' and j.entry_date>=p_month and j.entry_date<(p_month+interval '1 month')::date
 and j.fiscal_year_closure_id is null and a.type in ('revenue','income','expense'))
 then raise exception 'Historical opening and operating P&L overlap; reconcile before distribution';end if;
 return query select sum(h.net_profit)::numeric,count(*)::bigint,
 (array_agg(l.account_id))[1],greatest(max(j.entry_date),(p_month+interval '1 month - 1 day')::date)
 from public.transport_vehicle_historical_profits h
 join public.journal_lines l on l.id=h.source_journal_line_id and l.company_id=c and l.business_unit_id=b
 join public.journal_entries j on j.id=l.entry_id and j.company_id=c and j.business_unit_id=b
 where h.company_id=c and h.business_unit_id=b and h.month=p_month;
end $$;
revoke all on function public.transport_profit_historical_source(date) from public,anon,authenticated;

create or replace function public.transport_profit_appropriation_account_for_month(p_month date)
returns uuid language plpgsql stable security definer set search_path=public,pg_temp as $$
declare gl uuid;
begin
 perform public.transport_profit_month_assert('read');
 select h.account_id into gl from public.transport_profit_historical_source(p_month) h;
 if gl is not null then return gl;end if;
 return public.transport_profit_appropriation_account();
end $$;
revoke all on function public.transport_profit_appropriation_account_for_month(date) from public,anon,authenticated;



create or replace function public.transport_profit_month_source(p_month date)
returns table(net_profit numeric,line_count bigint) language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();
begin
 perform public.transport_profit_month_assert('read');
 if p_month is null or p_month<>date_trunc('month',p_month)::date then raise exception 'Month start required';end if;
 if exists(select 1 from public.transport_vehicle_historical_profits h where h.company_id=c and h.business_unit_id=b and h.month=p_month) then
  return query select h.net_profit,h.line_count from public.transport_profit_historical_source(p_month) h;return;
 end if;
 return query select coalesce(round(sum(case
     when a.type in ('revenue','income') then l.credit-l.debit
     when a.type='expense' then l.credit-l.debit
     else 0 end),2),0)::numeric, count(*)::bigint
 from public.journal_entries e
 join public.journal_lines l on l.entry_id=e.id and l.company_id=c and l.business_unit_id=b
 join public.chart_of_accounts a on a.id=l.account_id and a.company_id=c
 where e.company_id=c and e.business_unit_id=b and e.status='posted'
   and e.entry_date>=p_month and e.entry_date<(p_month+interval '1 month')::date
   and e.fiscal_year_closure_id is null
   and a.type in ('revenue','income','expense') and not a.is_group;
end $$;

create or replace function public.transport_profit_month_status(p_month date)
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
 gl:=public.transport_profit_appropriation_account_for_month(p_month);
 if m.id is not null then allocation:=public.transport_profit_allocations(m.rule_id,m.own_fleet_profit,m.twakkal_profit);end if;
 return jsonb_build_object('month',p_month,'rule_id',r.id,'method',r.method,'record',case when m.id is null then null else
    jsonb_build_object('id',m.id,'status',m.status,'own_fleet_profit',m.own_fleet_profit,'twakkal_profit',m.twakkal_profit,
    'total_profit',m.total_profit,'source_note',m.source_note,'source_net_profit',m.source_net_profit,
    'approved_by',m.approved_by,'approved_at',m.approved_at,'journal_entry_id',m.journal_entry_id,
    'posted_at',m.posted_at,'created_by',m.created_by) end,
    'source_kind',case when exists(select 1 from public.transport_vehicle_historical_profits h where h.company_id=c and h.business_unit_id=b and h.month=p_month) then 'historical_opening' else 'posted_operations' end,'source_account_name',(select a.name from public.chart_of_accounts a where a.id=gl and a.company_id=c),'posted_net_profit',net,'posted_source_lines',cnt,'source_gl_account_id',gl,'allocations',allocation,
    'month_ended',p_month<date_trunc('month',current_date)::date,'posting_enabled',r.method='fixed_percentage');
end $$;

create or replace function public.transport_profit_month_save_draft(p_month date,p_own numeric,p_twakkal numeric,p_source_note text)
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
 perform public.transport_profit_appropriation_account_for_month(p_month);
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

create or replace function public.transport_profit_month_approve(p_month date)
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
 gl:=public.transport_profit_appropriation_account_for_month(p_month);
 select s.net_profit,s.line_count into net,cnt from public.transport_profit_month_source(p_month) s;
 if exists(select 1 from public.transport_vehicle_historical_profits h where h.company_id=c and h.business_unit_id=b and h.month=p_month)
 and (m.twakkal_profit<>0 or m.own_fleet_profit<>net) then raise exception 'Historical fleet opening must allocate its exact net profit once, with separate sources excluded';end if;
 if cnt=0 or net<=0 or m.total_profit>net then
    raise exception 'Reviewed distribution exceeds posted monthly P&L or no posted P&L evidence exists (available %, requested %)',net,m.total_profit;end if;
 if exists(select 1 from public.accounting_periods ap where ap.company_id=c and ap.status='closed'
 and (p_month+interval '1 month - 1 day')::date between ap.period_start and ap.period_end) then raise exception 'Accounting period closed';end if;
 update public.transport_profit_month_closings set status='approved',approved_by=auth.uid(),approved_at=now(),
   source_net_profit=net,source_line_count=cnt,source_gl_account_id=gl where id=m.id;
 return jsonb_build_object('status','approved','month',p_month,'posted_net_profit',net,'approved_profit',m.total_profit,'allocation',items);
end $$;

create or replace function public.transport_profit_month_post(p_month date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();u uuid:=public.legacy_data_user_id();
 m public.transport_profit_month_closings%rowtype;gl uuid;source_name text;
 amount numeric;net numeric;cnt bigint;items jsonb;item jsonb;je uuid:=gen_random_uuid();
 jno text;currency text;loc uuid:=public.current_operating_location_id();post_result jsonb;lines integer:=0;available_retained numeric;historical boolean;posting_day date;
begin
 perform public.transport_profit_month_assert('write');
 if loc is null then raise exception 'Active operating branch required before posting';end if;
 -- One row-level lock serializes retries; the existing approved snapshot is the sole source.
 select * into m from public.transport_profit_month_closings
 where company_id=c and business_unit_id=b and month=p_month for update;
 if m.id is null or m.status<>'approved' then raise exception 'Only approved, unposted month can be posted';end if;
 if p_month>=date_trunc('month',current_date)::date then raise exception 'Month not closed';end if;
 if u is null then raise exception 'Canonical accounting owner is missing';end if;
 gl:=public.transport_profit_appropriation_account_for_month(p_month);
 if gl is distinct from m.source_gl_account_id then raise exception 'Appropriation GL changed after approval';end if;
 select a.name into source_name from public.chart_of_accounts a where a.id=gl and a.company_id=c and a.is_active
  and a.type='equity' and a.allow_manual_entries and not a.is_group;
 if source_name is null then raise exception 'Appropriation GL missing';end if;
 historical:=exists(select 1 from public.transport_vehicle_historical_profits h where h.company_id=c and h.business_unit_id=b and h.month=p_month);
 posting_day:=(p_month+interval '1 month - 1 day')::date;
 if historical then
   select h.posting_date into posting_day from public.transport_profit_historical_source(p_month) h;
   if m.twakkal_profit<>0 or m.own_fleet_profit<>m.source_net_profit then raise exception 'Historical fleet opening must allocate exact net profit';end if;
 end if;
 -- Serialize distributions sharing an equity source before checking its balance.
 perform pg_advisory_xact_lock(hashtextextended('profit-source:'||c||':'||b||':'||gl,0));
 -- A monthly P&L result is NOT itself a posted equity balance.  The year-end
 -- closing engine transfers earnings to Retained Earnings separately.
 -- Reconcile by business unit and posted canonical journals only.
 select coalesce(round(sum(l.credit-l.debit),2),0) into available_retained
 from public.journal_lines l
 join public.journal_entries e on e.id=l.entry_id
 where e.company_id=c and e.business_unit_id=b and e.status='posted'
   and l.company_id=c and l.business_unit_id=b and l.account_id=gl;
 if available_retained < m.total_profit then
   raise exception 'Profit posting blocked: source equity balance (%) is less than requested distribution (%). Reconcile the source before posting.',available_retained,m.total_profit;
 end if;
 select s.net_profit,s.line_count into net,cnt from public.transport_profit_month_source(p_month) s;
 if cnt is distinct from m.source_line_count or net is distinct from m.source_net_profit or net<m.total_profit
    then raise exception 'Posted P&L changed after approval; reconcile and reapprove before posting';end if;
 if exists(select 1 from public.accounting_periods ap where ap.company_id=c and ap.status='closed'
 and posting_day between ap.period_start and ap.period_end)
 then raise exception 'Accounting period closed';end if;
 items:=public.transport_profit_allocations(m.rule_id,m.own_fleet_profit,m.twakkal_profit);
 if exists(select 1 from jsonb_array_elements(items) x where (x->>'account_id')::uuid=gl) then raise exception 'Appropriation GL is also a partner GL';end if;
 select base_currency_code into currency from public.companies where id=c;
 if currency is null then raise exception 'Company base currency is missing';end if;
 jno:='TPD-'||to_char(p_month,'YYYYMM')||'-'||left(replace(m.id::text,'-',''),8);
 insert into public.journal_entries(id,user_id,company_id,business_unit_id,entry_no,entry_date,
   description,status,payment_mode,trans_type,created_by,source_module,source_document_type,source_document_id,
   currency_code,exchange_rate,operating_location_id)
 values(je,u,c,b,jno,posting_day,
   'Transport monthly approved profit appropriation '||to_char(p_month,'YYYY-MM'),'draft','Accrual',
   'Transport Profit Distribution',auth.uid(),'transport','profit_distribution',m.id,currency,1,loc);
 insert into public.journal_lines (user_id,company_id,business_unit_id,operating_location_id,entry_id,account,account_id,debit,credit)
 values(u,c,b,loc,je,source_name,gl,m.total_profit,0);
 for item in select value from jsonb_array_elements(items) loop
   amount:=(item->>'total')::numeric;
   if amount>0 then
    insert into public.journal_lines (user_id,company_id,business_unit_id,operating_location_id,entry_id,account,account_id,debit,credit)
      values(u,c,b,loc,je,item->>'name',(item->>'account_id')::uuid,0,amount);
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

commit;
