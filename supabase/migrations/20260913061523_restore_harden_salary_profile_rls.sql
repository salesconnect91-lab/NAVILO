drop policy if exists employee_salary_profiles_modify on public.employee_salary_profiles;
drop policy if exists employee_salary_profiles_select on public.employee_salary_profiles;
drop policy if exists employee_salary_profiles_insert on public.employee_salary_profiles;
drop policy if exists employee_salary_profiles_update on public.employee_salary_profiles;
drop policy if exists employee_salary_profiles_delete on public.employee_salary_profiles;
create policy employee_salary_profiles_select on public.employee_salary_profiles for select to authenticated using (company_id=public.current_company_id() and public.has_module_permission(company_id,'accounting','view'));
create policy employee_salary_profiles_insert on public.employee_salary_profiles for insert to authenticated with check (company_id=public.current_company_id() and public.has_module_permission(company_id,'accounting','post'));
create policy employee_salary_profiles_update on public.employee_salary_profiles for update to authenticated using (company_id=public.current_company_id() and public.has_module_permission(company_id,'accounting','post')) with check (company_id=public.current_company_id() and public.has_module_permission(company_id,'accounting','post'));
create policy employee_salary_profiles_delete on public.employee_salary_profiles for delete to authenticated using (company_id=public.current_company_id() and public.has_module_permission(company_id,'accounting','delete'));
