-- NAVILO payroll/general-cash completion: dedicated Salary Payable, Loan Payable,
-- Owner Drawings, salary accrual sub-ledger and salary payment through liability.

alter table public.chart_of_accounts disable trigger tenant_context_stamp;
do $$
declare r record; v_parent uuid;
begin
  for r in select distinct on (company_id) company_id,user_id from public.chart_of_accounts order by company_id,created_at loop
    select id into v_parent from public.chart_of_accounts where company_id=r.company_id and is_group=true and type='liability' and (detail_type='Current Liabilities' or name='Current Liabilities') order by code limit 1;
    if not exists(select 1 from public.chart_of_accounts where company_id=r.company_id and detail_type='Salary Payable') then
      insert into public.chart_of_accounts(user_id,company_id,code,name,type,account_role,detail_type,parent_head,parent_id,is_group,normal_balance,allow_manual_entries,is_system_account,is_active,description)
      values(r.user_id,r.company_id,'2130','Salary Payable','liability','system','Salary Payable','Current Liabilities',v_parent,false,'credit',true,true,true,'Accrued employee salary liability');
    end if;
    if not exists(select 1 from public.chart_of_accounts where company_id=r.company_id and detail_type='Loan Payable') then
      insert into public.chart_of_accounts(user_id,company_id,code,name,type,account_role,detail_type,parent_head,parent_id,is_group,normal_balance,allow_manual_entries,is_system_account,is_active,description)
      values(r.user_id,r.company_id,'2140','Loan Payable','liability','general','Loan Payable','Current Liabilities',v_parent,false,'credit',true,false,true,'Loans received and repaid through General Cash');
    end if;
    select id into v_parent from public.chart_of_accounts where company_id=r.company_id and is_group=true and type='equity' order by code limit 1;
    if not exists(select 1 from public.chart_of_accounts where company_id=r.company_id and detail_type='Owner Drawings') then
      insert into public.chart_of_accounts(user_id,company_id,code,name,type,account_role,detail_type,parent_head,parent_id,is_group,normal_balance,allow_manual_entries,is_system_account,is_active,description)
      values(r.user_id,r.company_id,'3300','Owner Drawings','equity','general','Owner Drawings','Equity',v_parent,false,'debit',true,false,true,'Owner withdrawals from business');
    end if;
  end loop;
end $$;
alter table public.chart_of_accounts enable trigger tenant_context_stamp;

create table if not exists public.employee_salary_accruals(
 id uuid primary key default gen_random_uuid(),user_id uuid not null default public.legacy_data_user_id(),company_id uuid not null default public.current_company_id(),business_unit_id uuid not null default public.current_business_unit_id(),employee_id uuid not null references public.employees(id) on delete restrict,salary_month date not null,monthly_salary numeric(18,2) not null check(monthly_salary>=0),journal_entry_id uuid not null references public.journal_entries(id) on delete restrict,voucher_no text not null,created_at timestamptz not null default now(),unique(company_id,business_unit_id,employee_id,salary_month));
alter table public.employee_salary_accruals enable row level security;
drop policy if exists employee_salary_accruals_select on public.employee_salary_accruals;
create policy employee_salary_accruals_select on public.employee_salary_accruals for select to authenticated using(company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id());
grant select on public.employee_salary_accruals to authenticated;
revoke insert,update,delete on public.employee_salary_accruals from authenticated;

create or replace function public.accrue_employee_salary(p_employee_id uuid,p_salary_month date) returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_company uuid:=public.current_company_id();v_bu uuid:=public.current_business_unit_id();v_user uuid:=public.legacy_data_user_id();v_month date:=date_trunc('month',p_salary_month)::date;v_name text;v_salary numeric;v_effective date;v_expense uuid;v_payable uuid;v_je uuid:=gen_random_uuid();v_no text;v_expense_name text;v_payable_name text;v_existing record;v_legacy_expensed numeric:=0;v_gl_accrual numeric:=0;
begin
 perform public.assert_module_permission('accounting','post');
 select a.*,e.name into v_existing from public.employee_salary_accruals a join public.employees e on e.id=a.employee_id where a.company_id=v_company and a.business_unit_id=v_bu and a.employee_id=p_employee_id and a.salary_month=v_month;
 if found then return jsonb_build_object('success',true,'already_accrued',true,'entry_no',v_existing.voucher_no,'monthly_salary',v_existing.monthly_salary);end if;
 select e.name into v_name from public.employees e where e.id=p_employee_id and e.company_id=v_company and e.is_active=true;if not found then raise exception 'Active employee not found.';end if;
 select monthly_salary,effective_from into v_salary,v_effective from public.employee_salary_profiles where company_id=v_company and employee_id=p_employee_id;if not found then raise exception 'Monthly salary is not configured.';end if;
 if v_month<date_trunc('month',v_effective)::date then raise exception 'Salary month is before salary effective date.';end if;
 select account_id into v_expense from public.account_mappings where company_id=v_company and mapping_key='salary_expense';
 select id into v_payable from public.chart_of_accounts where company_id=v_company and detail_type='Salary Payable' and is_active=true and is_group=false order by created_at limit 1;
 if v_expense is null or v_payable is null then raise exception 'Salary Expense / Salary Payable setup is missing.';end if;
 select name into v_expense_name from public.chart_of_accounts where id=v_expense;select name into v_payable_name from public.chart_of_accounts where id=v_payable;
 select coalesce(sum(p.amount),0) into v_legacy_expensed from public.employee_salary_payments p where p.company_id=v_company and p.business_unit_id=v_bu and p.employee_id=p_employee_id and p.salary_month=v_month and exists(select 1 from public.journal_lines jl where jl.entry_id=p.journal_entry_id and jl.account_id=v_expense and jl.debit>0);
 v_gl_accrual:=greatest(round(v_salary-v_legacy_expensed,2),0);v_no:='SAL-ACC-'||upper(substr(replace(v_je::text,'-',''),1,10));
 if v_gl_accrual>0 then
  insert into public.journal_entries(id,user_id,company_id,business_unit_id,entry_no,entry_date,description,status,payment_mode,party_name,trans_type,created_by,source_module,source_document_type) values(v_je,v_user,v_company,v_bu,v_no,(v_month+interval '1 month - 1 day')::date,'Salary accrual - '||v_name||' - '||to_char(v_month,'Mon YYYY'),'draft','Accrual',v_name,'Salary Accrual',auth.uid(),'payroll','salary_accrual');
  insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account,account_id,debit,credit,party_name) values(v_user,v_company,v_bu,v_je,v_expense_name,v_expense,v_gl_accrual,0,v_name),(v_user,v_company,v_bu,v_je,v_payable_name,v_payable,0,v_gl_accrual,v_name);
  perform public.post_journal_entry(v_je);
 else
  v_je:=(select journal_entry_id from public.employee_salary_payments where company_id=v_company and business_unit_id=v_bu and employee_id=p_employee_id and salary_month=v_month order by payment_date limit 1);v_no:='LEGACY-'||to_char(v_month,'YYYYMM');
 end if;
 insert into public.employee_salary_accruals(user_id,company_id,business_unit_id,employee_id,salary_month,monthly_salary,journal_entry_id,voucher_no) values(v_user,v_company,v_bu,p_employee_id,v_month,round(v_salary,2),v_je,v_no);
 return jsonb_build_object('success',true,'already_accrued',false,'entry_no',v_no,'monthly_salary',round(v_salary,2),'gl_accrual',v_gl_accrual,'legacy_expensed',v_legacy_expensed);
end;$$;
grant execute on function public.accrue_employee_salary(uuid,date) to authenticated;

create or replace function public.get_employee_salary_summary(p_employee_id uuid,p_salary_month date) returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_company uuid:=public.current_company_id();v_bu uuid:=public.current_business_unit_id();v_month date:=date_trunc('month',p_salary_month)::date;v_salary numeric:=0;v_effective date;v_previous numeric:=0;v_paid_month numeric:=0;v_current numeric:=0;v_total numeric:=0;v_accrued boolean:=false;
begin
 perform public.assert_module_permission('accounting','view');
 select monthly_salary,effective_from into v_salary,v_effective from public.employee_salary_profiles where company_id=v_company and employee_id=p_employee_id;if not found then return jsonb_build_object('configured',false,'monthly_salary',0,'previous_balance',0,'paid_in_month',0,'total_payable',0,'remaining_balance',0,'accrued',false);end if;
 select greatest(coalesce(sum(a.monthly_salary),0)-coalesce((select sum(p.amount) from public.employee_salary_payments p where p.company_id=v_company and p.business_unit_id=v_bu and p.employee_id=p_employee_id and p.salary_month<v_month),0),0) into v_previous from public.employee_salary_accruals a where a.company_id=v_company and a.business_unit_id=v_bu and a.employee_id=p_employee_id and a.salary_month<v_month;
 select coalesce(sum(amount),0) into v_paid_month from public.employee_salary_payments where company_id=v_company and business_unit_id=v_bu and employee_id=p_employee_id and salary_month=v_month;
 select coalesce(max(monthly_salary),0),count(*)>0 into v_current,v_accrued from public.employee_salary_accruals where company_id=v_company and business_unit_id=v_bu and employee_id=p_employee_id and salary_month=v_month;if not v_accrued then v_current:=v_salary;end if;
 v_total:=greatest(round(v_previous+v_current-v_paid_month,2),0);return jsonb_build_object('configured',true,'monthly_salary',round(v_salary,2),'effective_from',v_effective,'previous_balance',round(v_previous,2),'paid_in_month',round(v_paid_month,2),'total_payable',v_total,'remaining_balance',v_total,'accrued',v_accrued);
end;$$;
grant execute on function public.get_employee_salary_summary(uuid,date) to authenticated;

create or replace function public.post_salary_payment(p_employee_id uuid,p_salary_month date,p_transaction_date date,p_salary_account_id uuid,p_cash_bank_account_id uuid,p_amount numeric,p_reference text default null,p_notes text default null) returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_company uuid:=public.current_company_id();v_bu uuid:=public.current_business_unit_id();v_user uuid:=public.legacy_data_user_id();v_name text;v_summary jsonb;v_payable numeric;v_salary_payable uuid;v_cash_name text;v_payable_name text;v_je uuid:=gen_random_uuid();v_no text;v_month date:=date_trunc('month',p_salary_month)::date;v_accrual jsonb;
begin
 perform public.assert_module_permission('accounting','post');select name into v_name from public.employees where id=p_employee_id and company_id=v_company and is_active=true;if not found then raise exception 'Active employee not found.';end if;
 v_accrual:=public.accrue_employee_salary(p_employee_id,v_month);v_summary:=public.get_employee_salary_summary(p_employee_id,v_month);v_payable:=coalesce((v_summary->>'total_payable')::numeric,0);if coalesce(p_amount,0)<=0 then raise exception 'Payment amount must be greater than zero.';end if;if round(p_amount,2)>round(v_payable,2) then raise exception 'Payment amount cannot exceed salary payable of %.',round(v_payable,2);end if;
 select id into v_salary_payable from public.chart_of_accounts where company_id=v_company and detail_type='Salary Payable' and is_active=true and is_group=false order by created_at limit 1;select name into v_payable_name from public.chart_of_accounts where id=v_salary_payable;select name into v_cash_name from public.chart_of_accounts where id=p_cash_bank_account_id and company_id=v_company and is_active=true and is_group=false and allow_manual_entries=true and detail_type in('Cash on Hand','Bank Account');if v_payable_name is null or v_cash_name is null then raise exception 'Salary Payable / Cash-Bank account is invalid.';end if;
 v_no:='SAL-PAY-'||upper(substr(replace(v_je::text,'-',''),1,10));insert into public.journal_entries(id,user_id,company_id,business_unit_id,entry_no,entry_date,description,status,payment_mode,party_name,trans_type,payment_amount,created_by,source_module,source_document_type) values(v_je,v_user,v_company,v_bu,v_no,p_transaction_date,'Salary payment - '||v_name||' - '||to_char(v_month,'Mon YYYY'),'draft',case when exists(select 1 from public.chart_of_accounts where id=p_cash_bank_account_id and detail_type='Bank Account') then 'Bank' else 'Cash' end,v_name,'Salary Payment',round(p_amount,2),auth.uid(),'payroll','salary_payment');
 insert into public.journal_lines(user_id,company_id,business_unit_id,entry_id,account,account_id,debit,credit,party_name) values(v_user,v_company,v_bu,v_je,v_payable_name,v_salary_payable,round(p_amount,2),0,v_name),(v_user,v_company,v_bu,v_je,v_cash_name,p_cash_bank_account_id,0,round(p_amount,2),v_name);perform public.post_journal_entry(v_je);
 insert into public.employee_salary_payments(user_id,company_id,business_unit_id,employee_id,salary_month,payment_date,amount,journal_entry_id,voucher_no) values(v_user,v_company,v_bu,p_employee_id,v_month,p_transaction_date,round(p_amount,2),v_je,v_no);
 return jsonb_build_object('success',true,'entry_no',v_no,'journal_entry_id',v_je,'employee_id',p_employee_id,'employee_name',v_name,'salary_month',v_month,'monthly_salary',(v_summary->>'monthly_salary')::numeric,'previous_balance',(v_summary->>'previous_balance')::numeric,'paid_before_this_payment',(v_summary->>'paid_in_month')::numeric,'total_payable_before_payment',v_payable,'remaining_balance',greatest(round(v_payable-p_amount,2),0),'accrual_entry_no',v_accrual->>'entry_no');
end;$$;
grant execute on function public.post_salary_payment(uuid,date,date,uuid,uuid,numeric,text,text) to authenticated;

create or replace view public.employee_salary_ledger as
select p.company_id,p.business_unit_id,p.employee_id,e.employee_code,e.name employee_name,e.designation,e.department,p.salary_month,p.payment_date entry_date,p.voucher_no document_no,'Payment'::text entry_type,0::numeric debit,p.amount credit,p.journal_entry_id from public.employee_salary_payments p join public.employees e on e.id=p.employee_id
union all
select a.company_id,a.business_unit_id,a.employee_id,e.employee_code,e.name,e.designation,e.department,a.salary_month,(a.salary_month+interval '1 month - 1 day')::date,a.voucher_no,'Accrual',a.monthly_salary,0,a.journal_entry_id from public.employee_salary_accruals a join public.employees e on e.id=a.employee_id;
grant select on public.employee_salary_ledger to authenticated;
