begin;
create or replace function public.transport_driver_trip_pay_status(p_trip_id uuid) returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype;e uuid;l boolean:=false;
begin
 perform public.transport_finance_assert('driver');t:=public.transport_financial_trip(p_trip_id);
 select employee_id into e from public.transport_drivers where id=t.driver_id;
 select exists(select 1 from public.transport_driver_month_closings c where c.company_id=t.company_id and c.business_unit_id=t.business_unit_id and c.operating_location_id=t.operating_location_id and c.employee_id=e and c.month=date_trunc('month',t.trip_date)::date) into l;
 return jsonb_build_object('locked',l,'driver_pay',coalesce(t.driver_pay,0),'month',date_trunc('month',t.trip_date)::date);
end $$;
grant execute on function public.transport_driver_trip_pay_status(uuid) to authenticated;
commit;