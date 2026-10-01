begin;
do $$
begin
  if to_regclass('public.transport_trips') is null then raise exception 'transport_trips missing'; end if;
  if to_regclass('public.transport_trip_audit') is null then raise exception 'transport_trip_audit missing'; end if;
  if to_regclass('public.transport_driver_expenses') is null then raise exception 'transport_driver_expenses missing'; end if;
  if to_regclass('public.transport_trip_register') is null then raise exception 'transport_trip_register missing'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.transport_trips'::regclass and contype='u'
    and pg_get_constraintdef(oid) like '%company_id, trip_no%') then
    raise exception 'company-wide trip number uniqueness missing';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='transport_trips' and policyname='transport_trips_read') then
    raise exception 'transport trip RLS read policy missing';
  end if;
  raise notice 'PASS: fresh Transport V1 schema, company-wide trip uniqueness, audit and RLS foundation present';
end$$;
rollback;
