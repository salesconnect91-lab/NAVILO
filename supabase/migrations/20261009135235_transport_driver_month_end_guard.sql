-- Prevent incomplete or future driver months from being locked.
begin;
create or replace function public.transport_driver_post_month(p_employee_id uuid,p_month date) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();m date:=date_trunc('month',p_month)::date;
 a uuid;an text;exp uuid;expn text;dedacc uuid;dedn text;ename text;v jsonb;earn numeric;ded numeric;je uuid:=gen_random_uuid();jno text;
begin
 perform public.transport_finance_assert('driver');perform public.assert_module_permission('accounting','post');
 if auth.uid() is null or m is null or loc is null then raise exception 'Active company/branch and month required';end if;
 if m>=date_trunc('month',current_date)::date then raise exception 'Driver month must finish before posting and locking';end if;
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

commit;
