begin;

create or replace function public.assign_employee_code()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_next integer;
begin
  if tg_op='UPDATE' then
    if old.employee_code is not null and btrim(old.employee_code)<>'' and new.employee_code is distinct from old.employee_code then
      raise exception 'Employee code is system-generated and cannot be changed';
    end if;
    return new;
  end if;

  if new.employee_code is null or btrim(new.employee_code)='' then
    perform pg_advisory_xact_lock(hashtextextended(new.company_id::text||':employee_code',0));
    select coalesce(max(n),0)+1 into v_next
    from (
      select (regexp_match(employee_code,'^EMP-([0-9]+)$'))[1]::integer as n
      from public.employees
      where employee_code ~ '^EMP-[0-9]+$'
        and (company_id=new.company_id or user_id=new.user_id)
    ) q;
    new.employee_code:='EMP-'||lpad(v_next::text,3,'0');
  end if;

  return new;
end
$$;

commit;
