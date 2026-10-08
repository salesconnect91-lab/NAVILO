-- Profit appropriation and reversal explicitly scoped to one active operating branch.
-- Forward only. No financial rows modified by migration.
begin;
create or replace function public.transport_profit_month_post(p_month date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();u uuid:=public.legacy_data_user_id();
 m public.transport_profit_month_closings%rowtype;gl uuid;source_name text;
 amount numeric;net numeric;cnt bigint;items jsonb;item jsonb;je uuid:=gen_random_uuid();
 jno text;currency text;loc uuid:=public.current_operating_location_id();post_result jsonb;lines integer:=0;
begin
 perform public.transport_profit_month_assert('write');
 if loc is null then raise exception 'Active operating branch required before posting';end if;
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
   currency_code,exchange_rate,operating_location_id)
 values(je,u,c,b,jno,(p_month+interval '1 month - 1 day')::date,
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

create or replace function public.transport_profit_month_reverse(p_month date,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();u uuid:=public.legacy_data_user_id();
 m public.transport_profit_month_closings%rowtype;je uuid:=gen_random_uuid();orig record;original_total numeric:=0;
 jno text;currency text;loc uuid:=public.current_operating_location_id();result jsonb;cnt integer;rv uuid;
begin
 perform public.transport_profit_month_assert('write');
 if loc is null then raise exception 'Active original operating branch required for reversal';end if;
 if p_month is null or p_month<>date_trunc('month',p_month)::date or length(btrim(coalesce(p_reason,''))) not between 10 and 2000
   then raise exception 'Month and correction reason (10-2000 characters) required';end if;
 if u is null then raise exception 'Canonical accounting owner required';end if;
 select * into m from public.transport_profit_month_closings
 where company_id=c and business_unit_id=b and month=p_month for update;
 if m.id is null or m.status<>'posted' or m.journal_entry_id is null
   then raise exception 'Only posted month can be reversed';end if;
 if exists(select 1 from public.transport_profit_month_reversals where closing_id=m.id)
   then raise exception 'Posted profit distribution has already been reversed';end if;
 select id,status,currency_code,operating_location_id into orig from public.journal_entries
 where id=m.journal_entry_id and company_id=c and business_unit_id=b and status='posted';
 if not found then raise exception 'Original posted journal missing';end if;
 if orig.operating_location_id is distinct from loc then raise exception 'Select the original posting branch before reversal';end if;
 select count(*),coalesce(sum(credit),0) into cnt,original_total from public.journal_lines
 where entry_id=m.journal_entry_id and company_id=c and business_unit_id=b and account_id is not null;
 if cnt<2 or original_total<>m.total_profit then raise exception 'Original journal does not match immutable profit snapshot';end if;
 select base_currency_code into currency from public.companies where id=c;
 if currency is null or orig.currency_code<>currency then raise exception 'Source journal currency mismatch';end if;
 if exists(select 1 from public.accounting_periods ap where ap.company_id=c and ap.status='closed'
    and current_date between ap.period_start and ap.period_end)
 then raise exception 'Current accounting period is closed; cannot date a reversal today';end if;
 jno:='TPDR-'||to_char(p_month,'YYYYMM')||'-'||left(replace(m.id::text,'-',''),8);
 insert into public.journal_entries(id,user_id,company_id,business_unit_id,entry_no,entry_date,description,
   status,payment_mode,trans_type,created_by,source_module,source_document_type,source_document_id,
   reversal_of_entry_id,reversal_reason,currency_code,exchange_rate,operating_location_id)
 values(je,u,c,b,jno,current_date,'Reversal of Transport profit allocation '||to_char(p_month,'YYYY-MM'),
   'draft','Accrual','Transport Profit Distribution Reversal',auth.uid(),
   'transport','profit_distribution_reversal',m.id,m.journal_entry_id,btrim(p_reason),currency,1,loc);
 insert into public.journal_lines(user_id,company_id,business_unit_id,operating_location_id,entry_id,account,account_id,debit,credit)
 select u,c,b,loc,je,l.account,l.account_id,l.credit,l.debit from public.journal_lines l
 where l.entry_id=m.journal_entry_id and l.company_id=c and l.business_unit_id=b
  and ((l.credit>0 and l.debit=0) or (l.debit>0 and l.credit=0));
 get diagnostics cnt=row_count;
 if cnt<2 then raise exception 'Original reversal lines incomplete';end if;
 result:=public.post_journal_entry(je);
 if (result->>'status') is distinct from 'posted' then raise exception 'Canonical reversal posting failed';end if;
 insert into public.transport_profit_month_reversals
 (company_id,business_unit_id,closing_id,original_journal_entry_id,reversal_journal_entry_id,reason,reversed_on,reversed_by)
 values(c,b,m.id,m.journal_entry_id,je,btrim(p_reason),current_date,auth.uid()) returning id into rv;
 return jsonb_build_object('status','reversed','closing_id',m.id,'original_journal_entry_id',m.journal_entry_id,
   'reversal_journal_entry_id',je,'reversal_id',rv,'journal_number',jno,'reversed_on',current_date);
end $$;

commit;