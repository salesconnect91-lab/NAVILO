-- Run only against the isolated local Supabase database. The transaction rolls back.
begin;
do $$
declare
  v_company uuid;
  v_unit uuid;
  v_count integer;
  v_code text := 'T' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
begin
  insert into public.companies(name, code, status)
  values ('Onboarding rehearsal', v_code, 'trial') returning id into v_company;

  select count(*) into v_count
  from public.business_units where company_id=v_company and is_default;
  if v_count <> 1 then raise exception 'Expected one bootstrapped default unit, got %', v_count; end if;
  select id into v_unit from public.business_units
  where company_id=v_company and is_default;

  -- The edge function now updates this row instead of inserting another default.
  update public.business_units set name='Trading Unit', code='TRADE', unit_type='retail'
  where id=v_unit and company_id=v_company;
  if not exists (select 1 from public.business_units
                 where id=v_unit and company_id=v_company and is_default
                   and name='Trading Unit' and code='TRADE' and unit_type='retail') then
    raise exception 'Default business unit was not reused';
  end if;
  raise notice 'PASS: one default unit bootstrapped and updated in place';
end $$;
rollback;
