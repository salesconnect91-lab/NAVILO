begin;
alter table public.transport_driver_month_adjustments add column if not exists trip_id uuid references public.transport_trips(id) on delete restrict;
create index if not exists transport_driver_month_adjustments_trip_idx on public.transport_driver_month_adjustments(company_id,business_unit_id,operating_location_id,employee_id,month,trip_id);
create or replace function public.transport_driver_add_adjustment(p_employee_id uuid,p_month date,p_kind text,p_amount numeric,p_note text default null,p_trip_id uuid default null) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();m date:=date_trunc('month',p_month)::date;rid uuid;t public.transport_trips%rowtype;te uuid;
begin
 perform public.transport_finance_assert('driver');
 if p_kind not in('allowance','bonus','loan_deduction','other_earning','other_deduction') or coalesce(p_amount,0)<=0 then raise exception 'Valid adjustment and positive amount required';end if;
 if exists(select 1 from public.transport_driver_month_closings where company_id=c and business_unit_id=b and operating_location_id=loc and employee_id=p_employee_id and month=m) then raise exception 'Driver month is posted and locked';end if;
 if p_trip_id is not null then t:=public.transport_financial_trip(p_trip_id);select employee_id into te from public.transport_drivers where id=t.driver_id;if te is distinct from p_employee_id or date_trunc('month',t.trip_date)::date<>m then raise exception 'Selected Trip does not belong to this driver/month';end if;end if;
 insert into public.transport_driver_month_adjustments(company_id,business_unit_id,operating_location_id,employee_id,month,kind,amount,note,trip_id) values(c,b,loc,p_employee_id,m,p_kind,round(p_amount,2),nullif(btrim(p_note),''),p_trip_id) returning id into rid;return rid;
end $$;
grant execute on function public.transport_driver_add_adjustment(uuid,date,text,numeric,text,uuid) to authenticated;
create or replace function public.transport_driver_month_detail(p_employee_id uuid,p_month date) returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();m date:=date_trunc('month',p_month)::date;ans jsonb;
begin
 if auth.uid() is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission required';end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.event_date,x.trip_no,x.kind),'[]') into ans from (
 select t.trip_date event_date,t.trip_no,'trip_pay'::text kind,coalesce(t.driver_pay,0)::numeric amount,null::text note,t.id trip_id from public.transport_trips t join public.transport_drivers d on d.id=t.driver_id and d.employee_id=p_employee_id where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc and t.trip_date>=m and t.trip_date<(m+interval '1 month')::date
 union all select coalesce(t.trip_date,a.month),t.trip_no,a.kind,a.amount,a.note,a.trip_id from public.transport_driver_month_adjustments a left join public.transport_trips t on t.id=a.trip_id where a.company_id=c and a.business_unit_id=b and a.operating_location_id=loc and a.employee_id=p_employee_id and a.month=m
 ) x;return ans;
end $$;
grant execute on function public.transport_driver_month_detail(uuid,date) to authenticated;
commit;