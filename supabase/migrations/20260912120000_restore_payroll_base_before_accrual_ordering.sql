create table if not exists public.employee_salary_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default public.legacy_data_user_id(),
  company_id uuid not null default public.current_company_id(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  monthly_salary numeric(18,2) not null check (monthly_salary >= 0),
  effective_from date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, employee_id)
);

create table if not exists public.employee_salary_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default public.legacy_data_user_id(),
  company_id uuid not null default public.current_company_id(),
  business_unit_id uuid not null default public.current_business_unit_id(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  salary_month date not null,
  payment_date date not null,
  amount numeric(18,2) not null check (amount > 0),
  journal_entry_id uuid not null references public.journal_entries(id) on delete restrict,
  voucher_no text not null,
  created_at timestamptz not null default now(),
  unique(journal_entry_id)
);

create index if not exists employee_salary_payments_employee_month_idx on public.employee_salary_payments(company_id, employee_id, salary_month, payment_date);

alter table public.employee_salary_profiles enable row level security;
alter table public.employee_salary_payments enable row level security;

drop policy if exists employee_salary_profiles_select on public.employee_salary_profiles;
create policy employee_salary_profiles_select on public.employee_salary_profiles for select to authenticated using (company_id = public.current_company_id());
drop policy if exists employee_salary_profiles_modify on public.employee_salary_profiles;
create policy employee_salary_profiles_modify on public.employee_salary_profiles for all to authenticated using (company_id = public.current_company_id()) with check (company_id = public.current_company_id());
drop policy if exists employee_salary_payments_select on public.employee_salary_payments;
create policy employee_salary_payments_select on public.employee_salary_payments for select to authenticated using (company_id = public.current_company_id() and business_unit_id = public.current_business_unit_id());

grant select on public.employee_salary_profiles, public.employee_salary_payments to authenticated;
revoke insert,update,delete on public.employee_salary_profiles from authenticated;
revoke insert,update,delete on public.employee_salary_payments from authenticated;

create or replace function public.set_employee_salary_profile(p_employee_id uuid,p_monthly_salary numeric,p_effective_from date) returns jsonb
language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_company uuid:=public.current_company_id(); v_user uuid:=public.legacy_data_user_id();
begin
 perform public.assert_module_permission('accounting','post');
 if v_company is null or v_user is null then raise exception 'Authentication and active company are required.'; end if;
 if coalesce(p_monthly_salary,0)<=0 then raise exception 'Monthly salary must be greater than zero.'; end if;
 if p_effective_from is null then raise exception 'Salary effective date is required.'; end if;
 if not exists(select 1 from public.employees e where e.id=p_employee_id and e.company_id=v_company and e.is_active=true) then raise exception 'Active employee not found in current company.'; end if;
 insert into public.employee_salary_profiles(user_id,company_id,employee_id,monthly_salary,effective_from)
 values(v_user,v_company,p_employee_id,round(p_monthly_salary,2),p_effective_from)
 on conflict(company_id,employee_id) do update set monthly_salary=excluded.monthly_salary,effective_from=excluded.effective_from,updated_at=now();
 return jsonb_build_object('success',true);
end; $$;
grant execute on function public.set_employee_salary_profile(uuid,numeric,date) to authenticated;

create or replace function public.get_employee_salary_summary(p_employee_id uuid,p_salary_month date) returns jsonb
language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_company uuid:=public.current_company_id(); v_bu uuid:=public.current_business_unit_id(); v_profile record; v_month date:=date_trunc('month',p_salary_month)::date; v_months_before integer; v_accrued_before numeric:=0; v_paid_before numeric:=0; v_paid_in_month numeric:=0; v_previous_balance numeric:=0; v_total_payable numeric:=0;
begin
 perform public.assert_module_permission('accounting','view');
 if v_company is null or v_bu is null then raise exception 'Active company/business unit is required.'; end if;
 select monthly_salary,effective_from into v_profile from public.employee_salary_profiles where company_id=v_company and employee_id=p_employee_id;
 if not found then return jsonb_build_object('configured',false,'monthly_salary',0,'previous_balance',0,'paid_in_month',0,'total_payable',0,'remaining_balance',0); end if;
 if v_month<date_trunc('month',v_profile.effective_from)::date then raise exception 'Salary month is before salary effective date.'; end if;
 v_months_before:=greatest(0,(extract(year from age(v_month,date_trunc('month',v_profile.effective_from)::date))*12+extract(month from age(v_month,date_trunc('month',v_profile.effective_from)::date)))::int);
 v_accrued_before:=round(v_months_before*v_profile.monthly_salary,2);
 select coalesce(sum(amount),0) into v_paid_before from public.employee_salary_payments where company_id=v_company and business_unit_id=v_bu and employee_id=p_employee_id and salary_month<v_month;
 select coalesce(sum(amount),0) into v_paid_in_month from public.employee_salary_payments where company_id=v_company and business_unit_id=v_bu and employee_id=p_employee_id and salary_month=v_month;
 v_previous_balance:=greatest(round(v_accrued_before-v_paid_before,2),0);
 v_total_payable:=greatest(round(v_previous_balance+v_profile.monthly_salary-v_paid_in_month,2),0);
 return jsonb_build_object('configured',true,'monthly_salary',round(v_profile.monthly_salary,2),'effective_from',v_profile.effective_from,'previous_balance',v_previous_balance,'paid_in_month',round(v_paid_in_month,2),'total_payable',v_total_payable,'remaining_balance',v_total_payable);
end; $$;
grant execute on function public.get_employee_salary_summary(uuid,date) to authenticated;

create or replace function public.post_salary_payment(p_employee_id uuid,p_salary_month date,p_transaction_date date,p_salary_account_id uuid,p_cash_bank_account_id uuid,p_amount numeric,p_reference text default null,p_notes text default null) returns jsonb
language plpgsql security definer set search_path='public','pg_temp' as $$
declare v_company uuid:=public.current_company_id(); v_bu uuid:=public.current_business_unit_id(); v_user uuid:=public.legacy_data_user_id(); v_employee_name text; v_summary jsonb; v_result jsonb; v_entry_id uuid; v_entry_no text; v_month date:=date_trunc('month',p_salary_month)::date; v_payable numeric;
begin
 perform public.assert_module_permission('accounting','post');
 if v_company is null or v_bu is null or v_user is null then raise exception 'Authentication and active company/business unit are required.'; end if;
 select name into v_employee_name from public.employees where id=p_employee_id and company_id=v_company and is_active=true;
 if not found then raise exception 'Active employee not found in current company.'; end if;
 v_summary:=public.get_employee_salary_summary(p_employee_id,v_month);
 if not coalesce((v_summary->>'configured')::boolean,false) then raise exception 'Monthly salary is not configured for this employee.'; end if;
 v_payable:=coalesce((v_summary->>'total_payable')::numeric,0);
 if coalesce(p_amount,0)<=0 then raise exception 'Payment amount must be greater than zero.'; end if;
 if round(p_amount,2)>round(v_payable,2) then raise exception 'Payment amount cannot exceed current salary payable of %.',round(v_payable,2); end if;
 v_result:=public.post_general_cash_bank_transaction(p_transaction_date,'salary_payment',p_salary_account_id,p_cash_bank_account_id,p_amount,v_employee_name,p_reference,p_notes);
 v_entry_id:=(v_result->>'journal_entry_id')::uuid; v_entry_no:=v_result->>'entry_no';
 insert into public.employee_salary_payments(user_id,company_id,business_unit_id,employee_id,salary_month,payment_date,amount,journal_entry_id,voucher_no)
 values(v_user,v_company,v_bu,p_employee_id,v_month,p_transaction_date,round(p_amount,2),v_entry_id,v_entry_no);
 return v_result||jsonb_build_object('employee_id',p_employee_id,'employee_name',v_employee_name,'salary_month',v_month,'monthly_salary',(v_summary->>'monthly_salary')::numeric,'previous_balance',(v_summary->>'previous_balance')::numeric,'paid_before_this_payment',(v_summary->>'paid_in_month')::numeric,'total_payable_before_payment',v_payable,'remaining_balance',greatest(round(v_payable-p_amount,2),0));
end; $$;
grant execute on function public.post_salary_payment(uuid,date,date,uuid,uuid,numeric,text,text) to authenticated;
