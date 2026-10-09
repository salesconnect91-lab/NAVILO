-- Controlled branch-month closing; partner distribution remains a manual journal.
begin;
create table public.transport_monthly_profit_closures (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 business_unit_id uuid not null references public.business_units(id),
 operating_location_id uuid not null references public.operating_locations(id),
 month date not null check(month=date_trunc('month',month)::date),
 account_id uuid not null references public.chart_of_accounts(id),
 net_profit numeric(18,2) not null,
 source_hash text not null,
 status text not null check(status in ('processing','closed')),
 journal_entry_id uuid unique references public.journal_entries(id),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(company_id,business_unit_id,operating_location_id,month)
);
alter table public.transport_monthly_profit_closures enable row level security;
revoke all on public.transport_monthly_profit_closures from public,anon,authenticated;
grant select on public.transport_monthly_profit_closures to authenticated;
create policy transport_monthly_profit_closures_read on public.transport_monthly_profit_closures
 for select to authenticated using(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id()
 and operating_location_id=public.current_operating_location_id() and public.has_module_permission(company_id,'accounting','view'));
alter table public.journal_entries add column monthly_profit_closure_id uuid references public.transport_monthly_profit_closures(id);

create function public.transport_monthly_profit_preview(p_month date)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
 result jsonb;rows jsonb;fingerprint text;net numeric;drafts bigint;historic boolean;closure jsonb;cnt bigint;
begin
 perform public.transport_profit_month_assert('read');
 if loc is null then raise exception 'Active branch required';end if;
 if p_month is null or p_month<>date_trunc('month',p_month)::date then raise exception 'Month start required';end if;
 select to_jsonb(x) into closure from public.transport_monthly_profit_closures x
 where x.company_id=c and x.business_unit_id=b and x.operating_location_id=loc and x.month=p_month;
 select count(*) into drafts from public.journal_entries j where j.company_id=c and j.business_unit_id=b and j.operating_location_id=loc
 and j.entry_date>=p_month and j.entry_date<(p_month+interval '1 month')::date and j.status='draft';
 select exists(select 1 from public.transport_vehicle_historical_profits h where h.company_id=c and h.business_unit_id=b and h.month=p_month) into historic;
 select coalesce(sum(l.credit-l.debit),0),count(*),md5(coalesce(string_agg(l.id::text||':'||l.account_id::text||':'||l.debit::text||':'||l.credit::text,',' order by l.id),''))
 into net,cnt,fingerprint from public.ledgers l join public.journal_entries j on j.id=l.journal_entry_id
 join public.chart_of_accounts a on a.id=l.account_id and a.company_id=c
 where l.company_id=c and l.business_unit_id=b and l.operating_location_id=loc and j.company_id=c and j.business_unit_id=b and j.operating_location_id=loc
 and j.status='posted' and l.entry_date>=p_month and l.entry_date<(p_month+interval '1 month')::date
 and j.fiscal_year_closure_id is null and j.monthly_profit_closure_id is null and j.trans_type is distinct from 'Year End Closing'
 and a.type in ('revenue','income','expense');
 select coalesce(jsonb_agg(to_jsonb(q) order by q.code),'[]'::jsonb) into rows from (
 select a.id account_id,a.code,a.name,a.type,round(sum(l.debit-l.credit),2) net_debit
 from public.ledgers l join public.journal_entries j on j.id=l.journal_entry_id join public.chart_of_accounts a on a.id=l.account_id and a.company_id=c
 where l.company_id=c and l.business_unit_id=b and l.operating_location_id=loc and j.company_id=c and j.business_unit_id=b and j.operating_location_id=loc
 and j.status='posted' and l.entry_date>=p_month and l.entry_date<(p_month+interval '1 month')::date
 and j.fiscal_year_closure_id is null and j.monthly_profit_closure_id is null and j.trans_type is distinct from 'Year End Closing'
 and a.type in ('revenue','income','expense') group by a.id,a.code,a.name,a.type having abs(round(sum(l.debit-l.credit),2))>=.01
 )q;
 return jsonb_build_object('month',p_month,'net_profit',round(net,2),'source_hash',fingerprint,'line_count',cnt,'accounts',rows,'draft_count',drafts,
 'historical_opening',historic,'closure',closure,'ready',closure is null and not historic and drafts=0 and cnt>0 and jsonb_array_length(rows)>0
 and p_month<date_trunc('month',current_date)::date);
end $$;
revoke all on function public.transport_monthly_profit_preview(date) from public,anon;
grant execute on function public.transport_monthly_profit_preview(date) to authenticated;

-- Every posting takes the same branch-month lock as closing. Backdated postings cannot change closed earnings.
create function public.guard_transport_monthly_profit_close()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.reversal_of_entry_id is not null and exists(select 1 from public.journal_entries j where j.id=new.reversal_of_entry_id and j.monthly_profit_closure_id is not null) then raise exception 'Monthly closing cannot be reversed through an ordinary journal';end if;
 if tg_op='UPDATE' and old.monthly_profit_closure_id is not null and old.status='posted' and (new.status is distinct from old.status or new.monthly_profit_closure_id is distinct from old.monthly_profit_closure_id) then raise exception 'Posted monthly closing is immutable';end if;
 if new.trans_type='Monthly Profit Closing' or new.monthly_profit_closure_id is not null then
  if not exists(select 1 from public.transport_monthly_profit_closures x where x.id=new.monthly_profit_closure_id
   and x.company_id=new.company_id and x.business_unit_id=new.business_unit_id and x.operating_location_id=new.operating_location_id
   and x.status='processing' and new.entry_date=(x.month+interval '1 month - 1 day')::date and new.trans_type='Monthly Profit Closing')
   and not (tg_op='UPDATE' and old.status='posted' and new.status='posted' and old.monthly_profit_closure_id=new.monthly_profit_closure_id)
  then raise exception 'Monthly closing journals can only be generated by Close Month';end if;
 end if;
 if new.status='posted' and (tg_op='INSERT' or old.status is distinct from 'posted') then
  perform pg_advisory_xact_lock(hashtextextended(new.company_id::text||':'||new.business_unit_id::text||':'||new.operating_location_id::text||':profit-close:'||date_trunc('month',new.entry_date)::date::text,0));
  if exists(select 1 from public.transport_monthly_profit_closures x where x.company_id=new.company_id and x.business_unit_id=new.business_unit_id
    and x.operating_location_id=new.operating_location_id and x.month=date_trunc('month',new.entry_date)::date and x.status='closed')
    and not (new.fiscal_year_closure_id is not null and exists(select 1 from public.fiscal_year_closures fy
     where fy.id=new.fiscal_year_closure_id and fy.company_id=new.company_id and fy.business_unit_id=new.business_unit_id and fy.status='processing'))
   then raise exception 'Profit month is closed. Post corrections and partner transfers in an open month';end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_transport_monthly_profit_close() from public,anon,authenticated;
create trigger guard_transport_monthly_profit_close before insert or update on public.journal_entries for each row execute function public.guard_transport_monthly_profit_close();

create function public.transport_close_profit_month(p_month date,p_account_id uuid,p_source_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();u uuid:=public.legacy_data_user_id();
 preview jsonb;cl uuid;je uuid;no text;net numeric;r record;balance numeric;
begin
 perform public.transport_profit_month_assert('write');
 if loc is null or u is null then raise exception 'Active branch and accounting user required';end if;
 if p_month is null or p_month<>date_trunc('month',p_month)::date or p_month>=date_trunc('month',current_date)::date then raise exception 'Only a finished month can close';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text||':'||b::text||':earnings-close',0));
 perform pg_advisory_xact_lock(hashtextextended(c::text||':'||b::text||':'||loc::text||':profit-close:'||p_month::text,0));
 preview:=public.transport_monthly_profit_preview(p_month);
 if preview->'closure'<>'null'::jsonb then raise exception 'This branch month is already closed';end if;
 if (preview->>'historical_opening')::boolean then raise exception 'Historical opening profit is already recorded; transfer its existing equity balance manually';end if;
 if not (preview->>'ready')::boolean then raise exception 'Finish the month, resolve draft journals and post income/expenses before closing';end if;
 if p_source_hash is null or p_source_hash is distinct from preview->>'source_hash' then raise exception 'Profit changed. Refresh and review the preview';end if;
 if not exists(select 1 from public.chart_of_accounts a where a.id=p_account_id and a.company_id=c and a.type='equity'
 and a.is_active and not a.is_group and a.allow_manual_entries and lower(a.name) not like '%august%') then raise exception 'Select an active posting equity account for ongoing Undistributed Profit';end if;
 if exists(select 1 from public.fiscal_year_closures fy where fy.company_id=c and fy.business_unit_id=b and fy.status='closed' and p_month between fy.year_start and fy.year_end) then raise exception 'Financial year already closed';end if;
 if exists(select 1 from public.accounting_periods ap where ap.company_id=c and ap.status='closed' and (p_month+interval '1 month - 1 day')::date between ap.period_start and ap.period_end) then raise exception 'Accounting period is closed; review before monthly profit closing';end if;
 select round(coalesce(sum(l.debit-l.credit),0),2) into balance from public.ledgers l join public.journal_entries j on j.id=l.journal_entry_id
 where l.company_id=c and l.business_unit_id=b and l.operating_location_id=loc and j.status='posted' and l.entry_date>=p_month and l.entry_date<(p_month+interval '1 month')::date;
 if abs(balance)>=.01 then raise exception 'Branch Trial Balance is not balanced';end if;
 if exists(select 1 from public.journal_entries j where j.company_id=c and j.business_unit_id=b and j.operating_location_id=loc and j.status='posted'
 and j.entry_date>=p_month and j.entry_date<(p_month+interval '1 month')::date and
 (select count(*) from public.journal_lines l where l.entry_id=j.id)<>(select count(*) from public.ledgers l where l.journal_entry_id=j.id)) then raise exception 'Posted journal / ledger evidence mismatch';end if;
 net:=(preview->>'net_profit')::numeric;
 insert into public.transport_monthly_profit_closures(company_id,business_unit_id,operating_location_id,month,account_id,net_profit,source_hash,status,created_by)
 values(c,b,loc,p_month,p_account_id,net,p_source_hash,'processing',auth.uid()) returning id into cl;
 no:='MPC-'||to_char(p_month,'YYYYMM')||'-'||substr(replace(loc::text,'-',''),1,8);
 insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,trans_type,monthly_profit_closure_id)
 values(u,c,b,loc,no,(p_month+interval '1 month - 1 day')::date,'Monthly profit closing '||to_char(p_month,'Mon YYYY'),'draft','Monthly Profit Closing',cl) returning id into je;
 for r in select * from jsonb_to_recordset(preview->'accounts') as x(account_id uuid,code text,name text,type text,net_debit numeric) loop
  insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit)
  values(u,c,b,loc,je,r.account_id,r.code||' - '||r.name,greatest(-r.net_debit,0),greatest(r.net_debit,0));
 end loop;
 if abs(net)>=.01 then
  insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit)
  select u,c,b,loc,je,a.id,a.code||' - '||a.name,greatest(-net,0),greatest(net,0) from public.chart_of_accounts a where a.id=p_account_id;
 end if;
 perform public.post_journal_entry(je);
 update public.transport_monthly_profit_closures set status='closed',journal_entry_id=je where id=cl;
 insert into public.audit_logs(user_id,module,action,table_name,record_id,record_name,performed_by,new_data,metadata)
 values(u,'accounting','CLOSE_MONTH','transport_monthly_profit_closures',cl,to_char(p_month,'YYYY-MM'),auth.uid(),jsonb_build_object('net_profit',net),jsonb_build_object('journal_entry_id',je,'company_id',c,'business_unit_id',b,'operating_location_id',loc));
 return jsonb_build_object('success',true,'journal_entry_id',je,'entry_no',no,'net_profit',net);
end $$;
revoke all on function public.transport_close_profit_month(date,uuid,text) from public,anon;
grant execute on function public.transport_close_profit_month(date,uuid,text) to authenticated;

-- Keep reported operating profit intact; year-end closing still includes monthly closing GL movements,
-- so it transfers only remaining unclosed earnings instead of recognising them twice.
do $$declare signature text;definition text;original text;begin
 foreach signature in array array['public.accounting_report_balances_scoped(date,date,boolean,text)','public.transport_profit_month_source(date)','public.transport_profit_historical_source(date)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);original:=definition;
  if signature like '%accounting_report%' then
   definition:=replace(definition,'j.trans_type is distinct from ''Year End Closing''','j.trans_type is distinct from ''Year End Closing'' and j.monthly_profit_closure_id is null');
  elsif signature like '%historical%' then
   definition:=replace(definition,'j.fiscal_year_closure_id is null','j.fiscal_year_closure_id is null and j.monthly_profit_closure_id is null');
  else
   definition:=replace(definition,'e.fiscal_year_closure_id is null','e.fiscal_year_closure_id is null and e.monthly_profit_closure_id is null');
  end if;
  if definition=original then raise exception 'Monthly closing report exclusion patch did not match: %',signature;end if;
  execute definition;
 end loop;
end $$;
-- Annual and monthly profit transfers must not calculate the same earnings concurrently.
do $$declare definition text;patched text;begin
 definition:=pg_get_functiondef('public.close_fiscal_year(integer)'::regprocedure);
 patched:=replace(definition,'perform public.assert_module_permission(''accounting'',''post'');',
 'perform public.assert_module_permission(''accounting'',''post'');
  perform pg_advisory_xact_lock(hashtextextended(public.current_company_id()::text||'':''||public.current_business_unit_id()::text||'':earnings-close'',0));');
 if patched=definition then raise exception 'Annual closing serialization patch did not match';end if;
 execute patched;
end $$;
notify pgrst,'reload schema';
commit;
