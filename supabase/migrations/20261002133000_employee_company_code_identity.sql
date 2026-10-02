begin;

-- Employees are company-owned masters. The legacy uniqueness rule on
-- (user_id, employee_code) incorrectly collides when the same signed-in
-- administrator creates EMP-001 in more than one company.
-- Company-scoped uniqueness already exists as employees_company_code_uidx.
drop index if exists public.employees_user_code_unique;

commit;
