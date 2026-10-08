-- Financial corrections for Transport partner profit closing:
-- approved-unposted draft may be reopened with audit; posted journal reversed by new dated canonical journal.
begin;
create table public.transport_profit_month_events (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete restrict,
 business_unit_id uuid not null references public.business_units(id) on delete restrict,
 closing_id uuid not null references public.transport_profit_month_closings(id) on delete restrict,
 event_type text not null check(event_type='reopen_review'),
 reason text not null check(length(btrim(reason)) between 10 and 2000),
 old_snapshot jsonb not null,
 actor uuid not null references auth.users(id) on delete restrict,
 recorded_at timestamptz not null default now()
);
create table public.transport_profit_month_reversals (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete restrict,
 business_unit_id uuid not null references public.business_units(id) on delete restrict,
 closing_id uuid not null unique references public.transport_profit_month_closings(id) on delete restrict,
 original_journal_entry_id uuid not null references public.journal_entries(id) on delete restrict,
 reversal_journal_entry_id uuid not null unique references public.journal_entries(id) on delete restrict,
 reason text not null check(length(btrim(reason)) between 10 and 2000),
 reversed_on date not null,
 reversed_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now()
);
alter table public.transport_profit_month_events enable row level security;
alter table public.transport_profit_month_reversals enable row level security;
revoke all on public.transport_profit_month_events,public.transport_profit_month_reversals from public,anon,authenticated;
grant select on public.transport_profit_month_events,public.transport_profit_month_reversals to authenticated;
create policy transport_profit_events_owner_read on public.transport_profit_month_events for select to authenticated
 using(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id()
   and public.has_module_permission(company_id,'accounting','view')
   and (public.is_platform_owner() or exists(select 1 from public.business_unit_memberships bm where
      bm.company_id=transport_profit_month_events.company_id and
      bm.business_unit_id=transport_profit_month_events.business_unit_id and bm.user_id=auth.uid()
      and bm.is_active and bm.role in('company_owner','admin'))));
create policy transport_profit_reversal_owner_read on public.transport_profit_month_reversals for select to authenticated
 using(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id()
   and public.has_module_permission(company_id,'accounting','view')
   and (public.is_platform_owner() or exists(select 1 from public.business_unit_memberships bm where
      bm.company_id=transport_profit_month_reversals.company_id and
      bm.business_unit_id=transport_profit_month_reversals.business_unit_id and bm.user_id=auth.uid()
      and bm.is_active and bm.role in('company_owner','admin'))));

create function public.transport_profit_month_reopen_review(p_month date,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();
 m public.transport_profit_month_closings%rowtype;
begin
 perform public.transport_profit_month_assert('write');
 if p_month is null or p_month<>date_trunc('month',p_month)::date or length(btrim(coalesce(p_reason,''))) not between 10 and 2000
 then raise exception 'Month and correction reason (10-2000 characters) required';end if;
 select * into m from public.transport_profit_month_closings where company_id=c and business_unit_id=b and month=p_month for update;
 if m.id is null or m.status<>'approved' or m.journal_entry_id is not null
    then raise exception 'Only approved but UNPOSTED profit can return to Draft';end if;
 insert into public.transport_profit_month_events(company_id,business_unit_id,closing_id,event_type,reason,old_snapshot,actor)
 values(c,b,m.id,'reopen_review',btrim(p_reason),to_jsonb(m),auth.uid());
 update public.transport_profit_month_closings set status='draft',approved_by=null,approved_at=null,
 source_net_profit=null,source_line_count=null,source_gl_account_id=null where id=m.id;
 return jsonb_build_object('status','draft','month',p_month,'event','reopen_review');
end $$;
revoke all on function public.transport_profit_month_reopen_review(date,text) from public,anon;
grant execute on function public.transport_profit_month_reopen_review(date,text) to authenticated;

create function public.transport_profit_month_reversal_info(p_month date)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();r record;
begin
 perform public.transport_profit_month_assert('read');
 if p_month is null or p_month<>date_trunc('month',p_month)::date then raise exception 'Month required';end if;
 select v.id,v.reversal_journal_entry_id,v.reversed_on,v.reason into r
 from public.transport_profit_month_reversals v join public.transport_profit_month_closings m on m.id=v.closing_id
 where m.company_id=c and m.business_unit_id=b and m.month=p_month;
 if not found then return null;end if;
 return jsonb_build_object('id',r.id,'reversal_journal_entry_id',r.reversal_journal_entry_id,
   'reversed_on',r.reversed_on,'reason',r.reason);
end $$;
revoke all on function public.transport_profit_month_reversal_info(date) from public,anon;
grant execute on function public.transport_profit_month_reversal_info(date) to authenticated;

create function public.transport_profit_month_reverse(p_month date,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();u uuid:=public.legacy_data_user_id();
 m public.transport_profit_month_closings%rowtype;je uuid:=gen_random_uuid();orig record;original_total numeric:=0;
 jno text;currency text;result jsonb;cnt integer;rv uuid;
begin
 perform public.transport_profit_month_assert('write');
 if p_month is null or p_month<>date_trunc('month',p_month)::date or length(btrim(coalesce(p_reason,''))) not between 10 and 2000
   then raise exception 'Month and correction reason (10-2000 characters) required';end if;
 if u is null then raise exception 'Canonical accounting owner required';end if;
 select * into m from public.transport_profit_month_closings
 where company_id=c and business_unit_id=b and month=p_month for update;
 if m.id is null or m.status<>'posted' or m.journal_entry_id is null
   then raise exception 'Only posted month can be reversed';end if;
 if exists(select 1 from public.transport_profit_month_reversals where closing_id=m.id)
   then raise exception 'Posted profit distribution has already been reversed';end if;
 select id,status,currency_code into orig from public.journal_entries
 where id=m.journal_entry_id and company_id=c and business_unit_id=b and status='posted';
 if not found then raise exception 'Original posted journal missing';end if;
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
   reversal_of_entry_id,reversal_reason,currency_code,exchange_rate)
 values(je,u,c,b,jno,current_date,'Reversal of Transport profit allocation '||to_char(p_month,'YYYY-MM'),
   'draft','Accrual','Transport Profit Distribution Reversal',auth.uid(),
   'transport','profit_distribution_reversal',m.id,m.journal_entry_id,btrim(p_reason),currency,1);
 insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account,account_id,debit,credit)
 select u,c,b,je,l.account,l.account_id,l.credit,l.debit from public.journal_lines l
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
revoke all on function public.transport_profit_month_reverse(date,text) from public,anon;
grant execute on function public.transport_profit_month_reverse(date,text) to authenticated;
commit;