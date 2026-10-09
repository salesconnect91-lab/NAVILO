-- Synthetic local fixtures, rollback; canonical posting and authenticated RPCs.
begin;
do $$
declare u uuid:=gen_random_uuid();c uuid;b uuid;loc uuid;cash uuid;rev uuid;exp uuid;equity uuid;je uuid;closing uuid;
 m date:=(date_trunc('year',current_date)-interval '4 months')::date;
 p jsonb;r jsonb;bad boolean;v numeric;before_count bigint;year integer;fy jsonb;
begin
 insert into auth.users(id,role,email,created_at,updated_at) values(u,'authenticated','monthly-'||u||'@navilo.test',now(),now());
 insert into public.user_profiles(id,user_id,email,role,platform_role,is_active) values(u,u,'monthly-'||u||'@navilo.test','admin','user',true);
 insert into public.companies(name,code,status) values('Monthly closing rehearsal','MC'||substr(u::text,1,8),'active') returning id into c;
 select id into b from public.business_units where company_id=c and is_default;
 update public.business_units set unit_type='transport' where id=b;
 insert into public.company_memberships(company_id,user_id,role,is_active) values(c,u,'company_owner',true);
 insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active) values(c,b,u,'company_owner',true) on conflict(business_unit_id,user_id) do update set is_active=true;
 insert into public.business_unit_modules(company_id,business_unit_id,module_key,enabled) values(c,b,'accounting',true),(c,b,'transport',true),(c,b,'settings',true) on conflict(business_unit_id,module_key) do update set enabled=true;
 insert into public.operating_locations(company_id,business_unit_id,code,name,location_type,is_active) values(c,b,'MC','Monthly Branch','branch',true) returning id into loc;
 insert into public.operating_location_memberships(company_id,business_unit_id,operating_location_id,user_id,role,is_active) values(c,b,loc,u,'company_owner',true);
 update public.user_profiles set last_company_id=c,last_business_unit_id=b where id=u;
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.company_settings(user_id,company_id,company_name) values(u,c,'Monthly closing rehearsal');
 perform public.initialize_default_coa();
 select account_id into cash from public.account_mappings where company_id=c and mapping_key='cash';
 select id into rev from public.chart_of_accounts where company_id=c and type in ('revenue','income') and not is_group and is_active limit 1;
 select id into exp from public.chart_of_accounts where company_id=c and type='expense' and not is_group and is_active limit 1;
 select account_id into equity from public.account_mappings where company_id=c and mapping_key='retained_earnings';
 if equity is null then
 insert into public.chart_of_accounts(user_id,company_id,code,name,type,normal_balance,detail_type,is_active,is_group,allow_manual_entries) values(u,c,'MC-EQUITY','Undistributed Profit','equity','credit','Retained Earnings',true,false,true) returning id into equity;
 insert into public.account_mappings(user_id,company_id,mapping_key,account_id) values(u,c,'retained_earnings',equity);
 end if;
 if cash is null or rev is null or exp is null then raise exception 'Fixture COA missing: cash %, revenue %, expense %',cash,rev,exp;end if;
 insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,trans_type)
 values(u,c,b,loc,'MC-INCOME',m+10,'Income test','draft','Journal Entry') returning id into je;
 insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit)
 select u,c,b,loc,je,id,code||' - '||name,case when id=cash then 1000 else 0 end,case when id=rev then 1000 else 0 end from public.chart_of_accounts where id in(cash,rev);
 update public.company_accounting_policies set backdate_days=3650 where company_id=c;
 perform public.post_journal_entry(je);
 insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,trans_type)
 values(u,c,b,loc,'MC-COST',m+11,'Cost test','draft','Journal Entry') returning id into je;
 insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit)
 select u,c,b,loc,je,id,code||' - '||name,case when id=exp then 300 else 0 end,case when id=cash then 300 else 0 end from public.chart_of_accounts where id in(cash,exp);
 perform public.post_journal_entry(je);
 set local role authenticated;
 p:=public.transport_monthly_profit_preview(m);
 if (p->>'net_profit')::numeric<>700 or not (p->>'ready')::boolean then raise exception 'Wrong monthly preview: %',p;end if;
 bad:=false;begin perform public.transport_close_profit_month(m,equity,'stale');exception when others then if position('Profit changed' in sqlerrm)>0 then bad:=true;else raise;end if;end;
 if not bad then raise exception 'Stale preview accepted';end if;
 bad:=false;begin perform public.transport_close_profit_month(date_trunc('month',current_date)::date,equity,p->>'source_hash');exception when others then if position('finished month' in sqlerrm)>0 then bad:=true;else raise;end if;end;
 if not bad then raise exception 'Current month accepted';end if;
 bad:=false;begin perform public.transport_close_profit_month(m,cash,p->>'source_hash');exception when others then if position('equity account' in sqlerrm)>0 then bad:=true;else raise;end if;end;
 if not bad then raise exception 'Asset closing source accepted';end if;
 r:=public.transport_close_profit_month(m,equity,p->>'source_hash');closing:=(r->>'journal_entry_id')::uuid;
 if (r->>'net_profit')::numeric<>700 then raise exception 'Closing profit wrong';end if;
 bad:=false;begin perform public.transport_close_profit_month(m,equity,p->>'source_hash');exception when others then if position('already closed' in sqlerrm)>0 then bad:=true;else raise;end if;end;
 if not bad then raise exception 'Duplicate closing accepted';end if;
 p:=public.accounting_report_balances_scoped(m,(m+interval '1 month - 1 day')::date,true,'branch');
 select sum((x->>'credit')::numeric-(x->>'debit')::numeric) into v from jsonb_array_elements(p)x where (x->>'account_id')::uuid in(rev,exp);
 if v<>700 then raise exception 'P&L became zero after closing: %',v;end if;
 select net_profit into v from public.transport_monthly_profit_closures where journal_entry_id=closing;
 if v<>700 then raise exception 'RLS closing history unreadable';end if;
 reset role;
 if (select sum(credit-debit) from public.ledgers where journal_entry_id=closing and account_id=equity)<>700 then raise exception 'Equity not credited';end if;
 if (select sum(debit-credit) from public.ledgers where company_id=c and account_id in(rev,exp))<>0 then raise exception 'Income expense GL not closed';end if;
 if (select sum(debit-credit) from public.ledgers where company_id=c)<>0 then raise exception 'TB imbalance';end if;
 -- A post dated inside closed month must roll back completely.
 insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,trans_type)
 values(u,c,b,loc,'MC-LATE',m+15,'Late cost','draft','Journal Entry') returning id into je;
 insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit)
 select u,c,b,loc,je,id,code||' - '||name,case when id=exp then 10 else 0 end,case when id=cash then 10 else 0 end from public.chart_of_accounts where id in(cash,exp);
 select count(*) into before_count from public.ledgers where company_id=c;
 bad:=false;begin perform public.post_journal_entry(je);exception when others then if position('Profit month is closed' in sqlerrm)>0 then bad:=true;else raise;end if;end;
 if not bad or (select count(*) from public.ledgers where company_id=c)<>before_count then raise exception 'Late posting changed closed books';end if;
 delete from public.journal_lines where entry_id=je;delete from public.journal_entries where id=je;
 -- Next month: draft blocks closing, then a loss debits equity and remains visible in P&L.
 insert into public.journal_entries(user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,trans_type)
 values(u,c,b,loc,'MC-LOSS',(m+interval '1 month')::date+10,'Loss test','draft','Journal Entry') returning id into je;
 insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account_id,account,debit,credit)
 select u,c,b,loc,je,id,code||' - '||name,case when id=exp then 100 else 0 end,case when id=cash then 100 else 0 end from public.chart_of_accounts where id in(cash,exp);
 p:=public.transport_monthly_profit_preview((m+interval '1 month')::date);
 if (p->>'draft_count')::integer<>1 or (p->>'ready')::boolean then raise exception 'Draft did not block closing';end if;
 perform public.post_journal_entry(je);
 p:=public.transport_monthly_profit_preview((m+interval '1 month')::date);
 r:=public.transport_close_profit_month((m+interval '1 month')::date,equity,p->>'source_hash');
 if (r->>'net_profit')::numeric<>-100 then raise exception 'Loss wrongly recognized';end if;
 if (select sum(credit-debit) from public.ledgers where company_id=c and account_id=equity)<>600 then raise exception 'Loss did not reduce equity';end if;
 p:=public.accounting_report_balances_scoped((m+interval '1 month')::date,(m+interval '2 months - 1 day')::date,true,'branch');
 select sum((x->>'credit')::numeric-(x->>'debit')::numeric) into v from jsonb_array_elements(p)x where (x->>'account_id')::uuid in(rev,exp);
 if v<>-100 then raise exception 'Closed loss removed from historical P&L';end if;
 -- Canonical year-end closes only residual GL, not the already appropriated profit.
 year:=extract(year from m);
 insert into public.accounting_periods(user_id,company_id,period_name,period_start,period_end,status)
 select u,c,to_char(d,'Mon YYYY'),d::date,(d+interval '1 month - 1 day')::date,'closed' from generate_series(make_date(year,1,1)::timestamp,make_date(year,12,1)::timestamp,interval '1 month')d;
 update public.company_accounting_policies set enforce_period_lock=false where company_id=c;
 fy:=public.close_fiscal_year(year);
 if (fy->>'net_profit_loss')::numeric<>0 then raise exception 'Year end double transferred monthly profit: %',fy;end if;
 if (select sum(credit-debit) from public.ledgers where company_id=c and account_id=equity)<>600 then raise exception 'Year end duplicated equity';end if;
 raise notice 'PASS monthly close: canonical journal, P&L preserved, GL zero, equity recognized once, retry/stale/current-month/account guard, late posting rollback, annual no double-count';
end $$;
rollback;
