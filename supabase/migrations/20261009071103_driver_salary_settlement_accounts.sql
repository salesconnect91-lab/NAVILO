begin;
-- One GL settlement account per employee-driver. Existing openings are linked,
-- never reposted, and a debit/credit change is a reporting classification only.
create table public.driver_salary_accounts(
 company_id uuid not null references public.companies(id),
 business_unit_id uuid not null references public.business_units(id),
 employee_id uuid not null references public.employees(id),
 account_id uuid not null references public.chart_of_accounts(id),
 linked_by uuid not null default auth.uid(),linked_at timestamptz not null default now(),
 primary key(company_id,business_unit_id,employee_id),unique(company_id,account_id)
);
alter table public.driver_salary_accounts enable row level security;
create policy driver_salary_accounts_read on public.driver_salary_accounts for select to authenticated
 using(company_id=public.current_company_id() and public.has_company_access(company_id)
 and (public.has_module_permission(company_id,'accounting','view') or public.has_module_permission(company_id,'transport','view')));
revoke all on public.driver_salary_accounts from public,anon,authenticated;
grant select on public.driver_salary_accounts to authenticated;
alter table public.transport_driver_month_closings add column basic_salary numeric(18,2) not null default 0 check(basic_salary>=0);

create function public.transport_link_opening_salary_accounts() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();r record;eid uuid;did uuid;n text;cnt int;linked int:=0;
begin
 if auth.uid() is null or c is null or b is null then raise exception 'Active company/business unit required';end if;
 perform public.assert_module_permission('accounting','post');
 if not public.has_transport_action_permission(c,'master_manage') then raise exception 'Transport master permission required';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text||b::text||'driver-salary-link',0));
 for r in select distinct a.id,a.name from public.chart_of_accounts a join public.ledgers l on l.account_id=a.id and l.company_id=a.company_id
  join public.journal_entries j on j.id=l.journal_entry_id and j.status='posted' and j.source_document_type='cutover_opening_balances'
  where a.company_id=c and l.business_unit_id=b and a.is_active and not a.is_group and a.allow_manual_entries
  and a.type in('asset','liability') and a.name~*' driver (advance|payable)$'
 loop
  if exists(select 1 from public.driver_salary_accounts where company_id=c and account_id=r.id) then continue;end if;
  n:=btrim(regexp_replace(r.name,' driver (advance|payable)$','','i'));
  select count(*),(array_agg(id))[1] into cnt,eid from public.employees where company_id=c and lower(btrim(name))=lower(n);
  if cnt>1 then raise exception 'Ambiguous employee name: %',n;end if;
  if eid is null then insert into public.employees(company_id,user_id,name,designation,department,is_active)
    values(c,public.legacy_data_user_id(),n,'Driver','Transport',true) returning id into eid;
  elsif not exists(select 1 from public.employees where id=eid and is_active) then raise exception 'Inactive employee: %',n;end if;
  select id into did from public.transport_drivers where company_id=c and business_unit_id=b and lower(btrim(driver_name))=lower(n);
  if did is null then insert into public.transport_drivers(company_id,business_unit_id,driver_name,employee_id,driver_type,is_active,notes)
   values(c,b,n,eid,'company',true,'Linked to original cutover salary balance; basic salary requires configuration') returning id into did;
  elsif not exists(select 1 from public.transport_drivers where id=did and employee_id=eid and driver_type='company' and supplier_id is null and is_active)
   then raise exception 'Driver identity/classification requires review: %',n;end if;
  if exists(select 1 from public.employee_salary_accruals where company_id=c and business_unit_id=b and employee_id=eid)
   or exists(select 1 from public.employee_salary_payments where company_id=c and business_unit_id=b and employee_id=eid)
   or exists(select 1 from public.transport_driver_month_closings where company_id=c and business_unit_id=b and employee_id=eid)
   then raise exception 'Existing payroll must be reconciled before linking %',n;end if;
  insert into public.driver_salary_accounts(company_id,business_unit_id,employee_id,account_id) values(c,b,eid,r.id);
  linked:=linked+1;
 end loop;
 return jsonb_build_object('linked',linked,'opening_reposted',false);
end $$;
revoke all on function public.transport_link_opening_salary_accounts() from public,anon;
grant execute on function public.transport_link_opening_salary_accounts() to authenticated;

create function public.transport_enable_driver_salary_account(p_employee_id uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();a uuid;n text;
begin
 if auth.uid() is null or c is null or b is null then raise exception 'Active company/business unit required';end if;
 perform public.assert_module_permission('accounting','post');
 if not public.has_transport_action_permission(c,'master_manage') then raise exception 'Transport master permission required';end if;
 perform public.transport_assert_company_employee_driver(p_employee_id);
 perform pg_advisory_xact_lock(hashtextextended(c::text||b::text||'driver-salary-link',0));
 select account_id into a from public.driver_salary_accounts where company_id=c and business_unit_id=b and employee_id=p_employee_id;
 if a is not null then return a;end if;
 if exists(select 1 from public.employee_salary_accruals where company_id=c and business_unit_id=b and employee_id=p_employee_id)
 or exists(select 1 from public.employee_salary_payments where company_id=c and business_unit_id=b and employee_id=p_employee_id)
 or exists(select 1 from public.transport_driver_month_closings where company_id=c and business_unit_id=b and employee_id=p_employee_id)
 then raise exception 'Historical payroll requires reconciliation before enabling a new salary account';end if;
 select name into n from public.employees where id=p_employee_id and company_id=c and is_active;
 if n is null then raise exception 'Active employee required';end if;
 if exists(select 1 from public.chart_of_accounts ca join public.ledgers l on l.account_id=ca.id and l.company_id=c and l.business_unit_id=b
  where ca.company_id=c and lower(ca.name) in(lower(n||' Driver Advance'),lower(n||' Driver Payable')))
 then raise exception 'Use opening salary linkage for this existing driver balance';end if;
 insert into public.chart_of_accounts(user_id,company_id,code,name,type,account_role,detail_type,parent_head,normal_balance,is_group,allow_manual_entries,is_active,description)
 values(public.legacy_data_user_id(),c,'DS-'||replace(p_employee_id::text,'-',''),n||' Driver Salary Balance','liability','general','Driver Salary Balance','Current Liabilities','credit',false,true,true,'Basic salary + trip earnings less salary payments; debit balance is salary advance') returning id into a;
 insert into public.driver_salary_accounts(company_id,business_unit_id,employee_id,account_id) values(c,b,p_employee_id,a);
 return a;
end $$;
revoke all on function public.transport_enable_driver_salary_account(uuid) from public,anon;
grant execute on function public.transport_enable_driver_salary_account(uuid) to authenticated;

create view public.driver_salary_account_movements with(security_invoker=true) as
select 'driver-salary:'||l.id event_id,s.company_id,s.business_unit_id,l.operating_location_id,null::uuid trip_id,s.employee_id,e.name party_name,
 j.id journal_entry_id,l.credit-l.debit amount,
 case when j.source_document_type='cutover_opening_balances' then 'salary_opening'
      when j.reversal_of_entry_id is not null then 'salary_reversal'
      when j.source_document_type='driver_month_closing' then 'driver_month_closing'
      when j.source_document_type='salary_payment' then 'salary_payment' else 'salary_balance_adjustment' end::text event_type,
 null::text trip_no,j.entry_no,l.entry_date event_date,j.description,j.created_at,l.credit debit,l.debit credit
from public.driver_salary_accounts s join public.ledgers l on l.company_id=s.company_id and l.business_unit_id=s.business_unit_id and l.account_id=s.account_id
join public.journal_entries j on j.id=l.journal_entry_id and j.company_id=s.company_id and j.status='posted'
join public.employees e on e.id=s.employee_id and e.company_id=s.company_id;
revoke all on public.driver_salary_account_movements from public,anon;
grant select on public.driver_salary_account_movements to authenticated;

-- Preserve the prior flow for employees/drivers without explicit salary linkage.
alter function public.transport_driver_month_preview(uuid,date) rename to transport_driver_month_preview_before_salary_link;
alter function public.transport_driver_post_month(uuid,date) rename to transport_driver_post_month_before_salary_link;
alter function public.get_employee_salary_summary(uuid,date) rename to get_employee_salary_summary_before_salary_link;
alter function public.post_salary_payment(uuid,date,date,uuid,uuid,numeric,text,text) rename to post_salary_payment_before_salary_link;
alter function public.accrue_employee_salary(uuid,date) rename to accrue_employee_salary_before_salary_link;
revoke all on function public.transport_driver_month_preview_before_salary_link(uuid,date),public.transport_driver_post_month_before_salary_link(uuid,date),
 public.get_employee_salary_summary_before_salary_link(uuid,date),public.post_salary_payment_before_salary_link(uuid,date,date,uuid,uuid,numeric,text,text),
 public.accrue_employee_salary_before_salary_link(uuid,date) from public,anon,authenticated;

create function public.transport_driver_month_preview(p_employee_id uuid,p_month date) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();m date:=date_trunc('month',p_month)::date;
 a uuid;basic numeric:=0;effective date;configured boolean:=false;op numeric:=0;movement numeric:=0;pa numeric:=0;tp numeric:=0;al numeric:=0;bo numeric:=0;oe numeric:=0;od numeric:=0;ld numeric:=0;locked jsonb;
begin
 if auth.uid() is null or not public.has_module_permission(c,'transport','view') or not public.has_module_permission(c,'accounting','view') then raise exception 'Transport and accounting view permissions required';end if;
 perform public.transport_assert_company_employee_driver(p_employee_id);
 select account_id into a from public.driver_salary_accounts where company_id=c and business_unit_id=b and employee_id=p_employee_id;
 if a is null then return public.transport_driver_month_preview_before_salary_link(p_employee_id,m);end if;
 select monthly_salary,effective_from into basic,effective from public.employee_salary_profiles where company_id=c and employee_id=p_employee_id;
 configured:=found and m>=date_trunc('month',effective)::date;basic:=case when configured then basic else 0 end;
 select coalesce(sum(credit-debit) filter(where entry_date<m),0),coalesce(sum(credit-debit) filter(where entry_date>=m),0)
 into op,movement from public.ledgers where company_id=c and business_unit_id=b and operating_location_id=loc and account_id=a and entry_date<(m+interval '1 month')::date;
 op:=coalesce(op,0);movement:=coalesce(movement,0);
 select coalesce(sum(p.amount),0) into pa from public.employee_salary_payments p join public.journal_entries j on j.id=p.journal_entry_id and j.status='posted'
 where p.company_id=c and p.business_unit_id=b and p.employee_id=p_employee_id and j.operating_location_id=loc and p.payment_date>=m and p.payment_date<(m+interval '1 month')::date
 and not exists(select 1 from public.journal_entries r where r.reversal_of_entry_id=j.id and r.status='posted');
 select to_jsonb(x) into locked from public.transport_driver_month_closings x where x.company_id=c and x.business_unit_id=b and x.operating_location_id=loc and x.employee_id=p_employee_id and x.month=m;
 if locked is not null then return locked||jsonb_build_object('locked',true,'salary_account_linked',true,'salary_account_id',a,'configured',true,'payments',pa,'opening_balance',op,'closing_balance',op+movement,'entry_no',(select entry_no from public.journal_entries where id=(locked->>'journal_entry_id')::uuid));end if;
 select coalesce(sum(t.driver_pay),0) into tp from public.transport_trips t join public.transport_drivers d on d.id=t.driver_id and d.employee_id=p_employee_id and d.company_id=c and d.business_unit_id=b and d.driver_type='company' and d.supplier_id is null
 where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc and t.trip_date>=m and t.trip_date<(m+interval '1 month')::date;
 select coalesce(sum(amount) filter(where kind='allowance'),0),coalesce(sum(amount) filter(where kind='bonus'),0),coalesce(sum(amount) filter(where kind='other_earning'),0),coalesce(sum(amount) filter(where kind='other_deduction'),0),coalesce(sum(amount) filter(where kind='loan_deduction'),0)
 into al,bo,oe,od,ld from public.transport_driver_month_adjustments where company_id=c and business_unit_id=b and operating_location_id=loc and employee_id=p_employee_id and month=m;
 return jsonb_build_object('month',m,'opening_balance',op,'basic_salary',basic,'configured',configured,'salary_account_linked',true,'salary_account_id',a,'effective_from',effective,
 'trip_pay',tp,'allowance',al,'bonus',bo,'other_earning',oe,'loan_deduction',ld,'other_deduction',od,'payments',pa,'closing_balance',op+movement+basic+tp+al+bo+oe-od-ld,'locked',false);
end $$;

create function public.transport_driver_post_month(p_employee_id uuid,p_month date) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();m date:=date_trunc('month',p_month)::date;
 a uuid;an text;exp uuid;expn text;dedacc uuid;dedn text;ename text;v jsonb;earn numeric;ded numeric;je uuid:=gen_random_uuid();jno text;
begin
 perform public.transport_finance_assert('driver');perform public.assert_module_permission('accounting','post');
 if auth.uid() is null or m is null or loc is null then raise exception 'Active company/branch and month required';end if;
 perform public.transport_assert_company_employee_driver(p_employee_id);
 select account_id into a from public.driver_salary_accounts where company_id=c and business_unit_id=b and employee_id=p_employee_id;
 if a is null then return public.transport_driver_post_month_before_salary_link(p_employee_id,m);end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text||b::text||p_employee_id::text||'salary-post',0));
 if exists(select 1 from public.transport_driver_month_closings where company_id=c and business_unit_id=b and employee_id=p_employee_id and month>=m) then raise exception 'Driver month is locked or a later month is already posted';end if;
 if exists(select 1 from public.employee_salary_accruals where company_id=c and business_unit_id=b and employee_id=p_employee_id and salary_month=m) then raise exception 'Payroll salary already accrued; reconcile before Driver Month posting';end if;
 v:=public.transport_driver_month_preview(p_employee_id,m);
 if not coalesce((v->>'configured')::boolean,false) then raise exception 'Configure basic salary and effective date before posting driver month';end if;
 if coalesce((v->>'loan_deduction')::numeric,0)<>0 then raise exception 'This is a salary balance account; loan deductions require separate loan setup';end if;
 earn:=round((v->>'basic_salary')::numeric+(v->>'trip_pay')::numeric+(v->>'allowance')::numeric+(v->>'bonus')::numeric+(v->>'other_earning')::numeric,2);
 ded:=round((v->>'other_deduction')::numeric,2);
 if earn<=0 or ded>earn then raise exception 'Positive earnings and deductions within earnings required';end if;
 select id,name into a,an from public.chart_of_accounts where id=a and company_id=c and is_active and not is_group and allow_manual_entries;
 select ca.id,ca.name into exp,expn from public.account_mappings map join public.chart_of_accounts ca on ca.id=map.account_id and ca.company_id=c and ca.type='expense' and ca.is_active and not ca.is_group where map.company_id=c and map.mapping_key='salary_expense';
 if a is null or exp is null then raise exception 'Driver salary settlement / Salary Expense mapping missing';end if;
 if ded>0 then select ca.id,ca.name into dedacc,dedn from public.account_mappings map join public.chart_of_accounts ca on ca.id=map.account_id and ca.company_id=c and ca.is_active and not ca.is_group where map.company_id=c and map.mapping_key='employee_other_deduction_receivable';if dedacc is null then raise exception 'Other deduction mapping required';end if;end if;
 select name into ename from public.employees where id=p_employee_id and company_id=c and is_active;
 jno:='DRV-'||to_char(m,'YYYYMM')||'-'||upper(substr(replace(je::text,'-',''),1,6));
 insert into public.journal_entries(id,user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,payment_mode,party_name,trans_type,created_by,source_module,source_document_type)
 values(je,public.legacy_data_user_id(),c,b,loc,jno,(m+interval '1 month - 1 day')::date,'Driver salary + trip earnings - '||ename||' - '||to_char(m,'Mon YYYY'),'draft','Accrual',ename,'Driver Month Closing',auth.uid(),'transport','driver_month_closing');
 insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account,account_id,debit,credit,party_name,base_debit,base_credit)
 values(public.legacy_data_user_id(),c,b,je,expn,exp,earn,0,ename,earn,0),(public.legacy_data_user_id(),c,b,je,an,a,0,earn,ename,0,earn);
 if ded>0 then insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account,account_id,debit,credit,party_name,base_debit,base_credit)
 values(public.legacy_data_user_id(),c,b,je,an,a,ded,0,ename,ded,0),(public.legacy_data_user_id(),c,b,je,dedn,dedacc,0,ded,ename,0,ded);end if;
 perform public.post_journal_entry(je);
 insert into public.transport_driver_month_closings(company_id,business_unit_id,operating_location_id,employee_id,month,opening_balance,basic_salary,trip_pay,allowance,bonus,other_earning,loan_deduction,other_deduction,payments,closing_balance,journal_entry_id,posted_by)
 values(c,b,loc,p_employee_id,m,(v->>'opening_balance')::numeric,(v->>'basic_salary')::numeric,(v->>'trip_pay')::numeric,(v->>'allowance')::numeric,(v->>'bonus')::numeric,(v->>'other_earning')::numeric,0,ded,(v->>'payments')::numeric,(v->>'closing_balance')::numeric,je,auth.uid());
 return v||jsonb_build_object('locked',true,'journal_entry_id',je,'entry_no',jno);
end $$;

create function public.get_employee_salary_summary(p_employee_id uuid,p_salary_month date) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v jsonb;n numeric;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;perform public.assert_module_permission('accounting','view');
 if not exists(select 1 from public.driver_salary_accounts where company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and employee_id=p_employee_id)
 then return public.get_employee_salary_summary_before_salary_link(p_employee_id,p_salary_month);end if;
 v:=public.transport_driver_month_preview(p_employee_id,p_salary_month);n:=(v->>'closing_balance')::numeric;
 return v||jsonb_build_object('monthly_salary',v->'basic_salary','previous_balance',v->'opening_balance','paid_in_month',v->'payments','total_payable',greatest(n,0),'remaining_balance',n,'salary_advance',greatest(-n,0),'accrued',v->'locked','driver_salary_account',true);
end $$;

create function public.accrue_employee_salary(p_employee_id uuid,p_salary_month date) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;perform public.assert_module_permission('accounting','post');
 if exists(select 1 from public.driver_salary_accounts where company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and employee_id=p_employee_id)
 then raise exception 'Use Driver Monthly Khata to post basic salary and trip earnings once';end if;
 return public.accrue_employee_salary_before_salary_link(p_employee_id,p_salary_month);
end $$;

create function public.post_salary_payment(p_employee_id uuid,p_salary_month date,p_transaction_date date,p_salary_account_id uuid,p_cash_bank_account_id uuid,p_amount numeric,p_reference text default null,p_notes text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();a uuid;an text;cashn text;ename text;je uuid:=gen_random_uuid();jno text;m date:=date_trunc('month',p_salary_month)::date;v jsonb;bal numeric;
begin
 if auth.uid() is null then raise exception 'Authentication required';end if;perform public.assert_module_permission('accounting','post');
 select account_id into a from public.driver_salary_accounts where company_id=c and business_unit_id=b and employee_id=p_employee_id;
 if a is null then return public.post_salary_payment_before_salary_link(p_employee_id,p_salary_month,p_transaction_date,p_salary_account_id,p_cash_bank_account_id,p_amount,p_reference,p_notes);end if;
 perform public.transport_assert_company_employee_driver(p_employee_id);
 if loc is null or m is null or p_transaction_date is null or coalesce(round(p_amount,2),0)<=0 then raise exception 'Valid branch, date, month and positive amount required';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text||b::text||p_employee_id::text||'salary-post',0));
 select name into ename from public.employees where id=p_employee_id and company_id=c and is_active;
 select name into an from public.chart_of_accounts where id=a and company_id=c and is_active and not is_group and allow_manual_entries;
 select name into cashn from public.chart_of_accounts where id=p_cash_bank_account_id and company_id=c and type='asset' and is_active and not is_group and allow_manual_entries and detail_type in('Cash on Hand','Bank Account');
 if p_salary_account_id is distinct from a then raise exception 'Select this driver salary balance account';end if;
 if ename is null or an is null or cashn is null or a=p_cash_bank_account_id then raise exception 'Valid employee, driver salary account and cash/bank required';end if;
 -- Salary payments/advances reduce this same driver balance. They do not accrue
 -- basic salary a second time and do not create loan transactions.
 v:=public.get_employee_salary_summary(p_employee_id,m);
 jno:='SAL-PAY-'||upper(substr(replace(je::text,'-',''),1,10));
 insert into public.journal_entries(id,user_id,company_id,business_unit_id,operating_location_id,entry_no,entry_date,description,status,payment_mode,party_name,trans_type,payment_amount,created_by,source_module,source_document_type)
 values(je,public.legacy_data_user_id(),c,b,loc,jno,p_transaction_date,'Driver salary payment / advance - '||ename||coalesce(' - '||nullif(p_reference,''),'')||coalesce(' - '||nullif(p_notes,''),''),'draft',case when exists(select 1 from public.chart_of_accounts where id=p_cash_bank_account_id and detail_type='Bank Account') then 'Bank' else 'Cash' end,ename,'Salary Payment',round(p_amount,2),auth.uid(),'payroll','salary_payment');
 insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account,account_id,debit,credit,party_name,base_debit,base_credit)
 values(public.legacy_data_user_id(),c,b,je,an,a,round(p_amount,2),0,ename,round(p_amount,2),0),(public.legacy_data_user_id(),c,b,je,cashn,p_cash_bank_account_id,0,round(p_amount,2),ename,0,round(p_amount,2));
 perform public.post_journal_entry(je);
 insert into public.employee_salary_payments(user_id,company_id,business_unit_id,employee_id,salary_month,payment_date,amount,journal_entry_id,voucher_no)
 values(public.legacy_data_user_id(),c,b,p_employee_id,m,p_transaction_date,round(p_amount,2),je,jno);
 select coalesce(sum(credit-debit),0) into bal from public.ledgers where company_id=c and business_unit_id=b and operating_location_id=loc and account_id=a and entry_date<=p_transaction_date;
 return jsonb_build_object('success',true,'entry_no',jno,'journal_entry_id',je,'employee_id',p_employee_id,'employee_name',ename,'salary_month',m,
 'monthly_salary',v->'monthly_salary','previous_balance',v->'previous_balance','paid_before_this_payment',v->'paid_in_month',
 'total_payable_before_payment',v->'total_payable','remaining_balance',bal,'salary_advance',greatest(-bal,0),'driver_salary_account',true);
end $$;

revoke all on function public.transport_driver_month_preview(uuid,date),public.transport_driver_post_month(uuid,date),public.get_employee_salary_summary(uuid,date),public.accrue_employee_salary(uuid,date),public.post_salary_payment(uuid,date,date,uuid,uuid,numeric,text,text) from public,anon;
grant execute on function public.transport_driver_month_preview(uuid,date),public.transport_driver_post_month(uuid,date),public.get_employee_salary_summary(uuid,date),public.accrue_employee_salary(uuid,date),public.post_salary_payment(uuid,date,date,uuid,uuid,numeric,text,text) to authenticated;

-- Reuse canonical employee salary ledger columns, retaining unmapped payroll.
create or replace view public.employee_salary_ledger with(security_invoker=true) as
select p.company_id,p.business_unit_id,p.employee_id,e.employee_code,e.name employee_name,e.designation,e.department,p.salary_month,p.payment_date entry_date,p.voucher_no document_no,'Payment'::text entry_type,0::numeric debit,p.amount credit,p.journal_entry_id
from public.employee_salary_payments p join public.employees e on e.id=p.employee_id and e.company_id=p.company_id join public.journal_entries j on j.id=p.journal_entry_id and j.status='posted'
where not exists(select 1 from public.driver_salary_accounts s where s.company_id=p.company_id and s.business_unit_id=p.business_unit_id and s.employee_id=p.employee_id)
union all
select a.company_id,a.business_unit_id,a.employee_id,e.employee_code,e.name,e.designation,e.department,a.salary_month,(a.salary_month+interval '1 month - 1 day')::date,a.voucher_no,'Accrual',a.monthly_salary,0,a.journal_entry_id
from public.employee_salary_accruals a join public.employees e on e.id=a.employee_id and e.company_id=a.company_id join public.journal_entries j on j.id=a.journal_entry_id and j.status='posted'
where not exists(select 1 from public.driver_salary_accounts s where s.company_id=a.company_id and s.business_unit_id=a.business_unit_id and s.employee_id=a.employee_id)
union all
select m.company_id,m.business_unit_id,m.employee_id,e.employee_code,e.name,e.designation,e.department,date_trunc('month',m.event_date)::date,m.event_date,m.entry_no,
 case m.event_type when 'salary_opening' then 'Opening salary balance' when 'driver_month_closing' then 'Basic salary + trip earnings' when 'salary_payment' then 'Payment' when 'salary_reversal' then 'Reversal' else 'Salary adjustment' end,
 m.debit,m.credit,m.journal_entry_id from public.driver_salary_account_movements m join public.employees e on e.id=m.employee_id and e.company_id=m.company_id;

alter view public.transport_driver_account_movements rename to transport_driver_account_movements_before_salary_link;
alter view public.transport_driver_account_movements_before_salary_link set(security_invoker=true);
create view public.transport_driver_account_movements with(security_invoker=true) as
select old.* from public.transport_driver_account_movements_before_salary_link old
where not exists(select 1 from public.driver_salary_accounts s where s.company_id=old.company_id and s.business_unit_id=old.business_unit_id and s.employee_id=old.employee_id)
union all
select m.* from public.driver_salary_account_movements m where m.company_id=public.current_company_id() and m.business_unit_id=public.current_business_unit_id()
 and m.operating_location_id=public.current_operating_location_id() and public.has_module_permission(m.company_id,'transport','view') and public.has_module_permission(m.company_id,'accounting','view');
revoke all on public.transport_driver_account_movements from public,anon;
grant select on public.transport_driver_account_movements to authenticated;
commit;
