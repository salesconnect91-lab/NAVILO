revoke insert,update,delete on public.employee_salary_profiles from authenticated;
revoke insert,update,delete on public.employee_salary_payments from authenticated;
grant select on public.employee_salary_profiles, public.employee_salary_payments to authenticated;
