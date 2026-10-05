-- Static/transactional rehearsal for canonical Transport trip expense posting.
-- Intended for isolated/local Supabase only. It rolls back all fixture writes.
begin;

do $$
declare
  v_company uuid := public.current_company_id();
  v_unit uuid := public.current_business_unit_id();
  v_trip uuid;
  v_type text;
begin
  if v_company is null or v_unit is null then
    raise exception 'TEST SETUP: active company/business unit required.';
  end if;

  if to_regprocedure('public.transport_post_trip_expense(uuid,date,text,numeric,text,text,text,uuid)') is null then
    raise exception 'FAIL: transport_post_trip_expense RPC is missing.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='transport_trip_expenses' and column_name='source_reference'
  ) then
    raise exception 'FAIL: source_reference column is missing.';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and tablename='transport_trip_expenses'
      and indexname='transport_trip_expenses_source_reference_uidx'
  ) then
    raise exception 'FAIL: expense source-reference unique index is missing.';
  end if;

  select t.id into v_trip
  from public.transport_trips t
  where t.company_id=v_company and t.business_unit_id=v_unit
  order by t.created_at desc nulls last limit 1;

  select et.name into v_type
  from public.transport_vehicle_expense_types et
  where et.company_id=v_company and et.business_unit_id=v_unit and et.is_active
  order by et.name limit 1;

  if v_trip is null or v_type is null then
    raise notice 'STRUCTURE PASS; runtime fixture skipped because no scoped Trip/Expense Type exists.';
  else
    raise notice 'STRUCTURE PASS; use authenticated isolated fixture to exercise posting permissions and rollback.';
  end if;
end $$;

rollback;
