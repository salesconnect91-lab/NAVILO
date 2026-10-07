-- Forward-only integrity guard: company Transport drivers must be linked to an employee.
-- NOT VALID preserves legacy rows while enforcing the rule for new/updated rows.
alter table public.transport_drivers
  drop constraint if exists transport_company_driver_employee_check;

alter table public.transport_drivers
  add constraint transport_company_driver_employee_check
  check (
    driver_type is null
    or driver_type <> 'company'
    or (employee_id is not null and supplier_id is null)
  ) not valid;

comment on constraint transport_company_driver_employee_check on public.transport_drivers is
  'New/updated company drivers require an employee link and cannot be supplier-linked; legacy rows are not rewritten.';
