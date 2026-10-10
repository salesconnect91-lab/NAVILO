-- Read-only trip comparison for the current tenant/business unit/operating location.
-- All years are compared through the same month/day (YTD) for fair comparisons.
create or replace function public.transport_trip_volume_comparison(p_as_of date)
returns jsonb
language plpgsql stable security definer
set search_path to 'public','pg_temp'
as $$
declare
  c uuid := public.current_company_id();
  b uuid := public.current_business_unit_id();
  loc uuid := public.current_operating_location_id();
  cutoff date;
  yr integer;
  month_rows jsonb;
  year_rows jsonb;
begin
  if auth.uid() is null or c is null or b is null or loc is null
     or not public.has_module_permission(c,'transport','view') then
    raise exception 'Active Transport view permission and operating location required';
  end if;
  if p_as_of is null or p_as_of < date '2005-01-01' then
    raise exception 'Valid trip comparison date required';
  end if;
  cutoff := least(p_as_of,current_date);
  yr := extract(year from cutoff)::integer;
  with counts as (
    select extract(year from t.trip_date)::integer y,
           extract(month from t.trip_date)::integer m,
           count(*)::integer n
    from public.transport_trips t
    where t.company_id=c and t.business_unit_id=b
      and t.operating_location_id=loc
      and t.trip_date >= make_date(yr-4,1,1)
      and t.trip_date <= cutoff
      and (
        extract(month from t.trip_date) < extract(month from cutoff)
        or (extract(month from t.trip_date)=extract(month from cutoff)
            and extract(day from t.trip_date)<=extract(day from cutoff))
      )
    group by 1,2
  ), months as (
    select m.month_no,
      coalesce(sum(n) filter (where y=yr),0)::integer current_trips,
      coalesce(sum(n) filter (where y=yr-1),0)::integer previous_trips
    from generate_series(1,12) m(month_no)
    left join counts on counts.m=m.month_no
    group by m.month_no
  ), years as (
    select y.year_no,coalesce(sum(n),0)::integer trips
    from generate_series(yr-4,yr) y(year_no)
    left join counts on counts.y=y.year_no
    group by y.year_no
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
      'month',month_no,'current',current_trips,'previous',previous_trips
    ) order by month_no),'[]'::jsonb) from months),
    (select coalesce(jsonb_agg(jsonb_build_object(
      'year',year_no,'trips',trips
    ) order by year_no),'[]'::jsonb) from years)
  into month_rows,year_rows;
  return jsonb_build_object(
    'as_of',cutoff,'current_year',yr,'previous_year',yr-1,
    'monthly',month_rows,'yearly',year_rows
  );
end;
$$;
revoke all on function public.transport_trip_volume_comparison(date) from public,anon;
grant execute on function public.transport_trip_volume_comparison(date) to authenticated;
