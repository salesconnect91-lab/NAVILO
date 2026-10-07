begin;

create or replace function public.transport_assert_company_employee_driver(p_employee_id uuid)
returns void language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id(); b uuid:=public.current_business_unit_id();
begin
 if auth.uid() is null or c is null or b is null then raise exception 'Active Transport workspace required'; end if;
 if not exists(
   select 1 from public.transport_drivers d
   where d.company_id=c and d.business_unit_id=b and d.employee_id=p_employee_id
     and d.is_active and lower(coalesce(d.driver_type,''))='company' and d.supplier_id is null
 ) then raise exception 'Driver Khata is available only for active company employee-drivers'; end if;
end $$;
revoke all on function public.transport_assert_company_employee_driver(uuid) from public;
grant execute on function public.transport_assert_company_employee_driver(uuid) to authenticated;

create or replace function public.transport_driver_month_detail(p_employee_id uuid,p_month date)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();m date:=date_trunc('month',p_month)::date;ans jsonb;
begin
 if auth.uid() is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission required';end if;
 perform public.transport_assert_company_employee_driver(p_employee_id);
 select coalesce(jsonb_agg(to_jsonb(x) order by x.event_date,x.trip_no,x.kind),'[]') into ans from (
  select t.trip_date event_date,t.trip_no,'trip_pay'::text kind,coalesce(t.driver_pay,0)::numeric amount,null::text note,t.id trip_id
  from public.transport_trips t
  join public.transport_drivers d on d.id=t.driver_id and d.employee_id=p_employee_id and d.company_id=c and d.business_unit_id=b
    and lower(coalesce(d.driver_type,''))='company' and d.supplier_id is null
  where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc and t.trip_date>=m and t.trip_date<(m+interval '1 month')::date
  union all
  select coalesce(t.trip_date,a.month),t.trip_no,a.kind,a.amount,a.note,a.trip_id
  from public.transport_driver_month_adjustments a left join public.transport_trips t on t.id=a.trip_id
  where a.company_id=c and a.business_unit_id=b and a.operating_location_id=loc and a.employee_id=p_employee_id and a.month=m
 ) x;
 return ans;
end $$;

create or replace function public.transport_driver_add_adjustment(p_employee_id uuid,p_month date,p_kind text,p_amount numeric,p_note text default null,p_trip_id uuid default null)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();m date:=date_trunc('month',p_month)::date;rid uuid;t public.transport_trips%rowtype;te uuid;
begin
 perform public.transport_finance_assert('driver');
 perform public.transport_assert_company_employee_driver(p_employee_id);
 if p_kind not in('allowance','bonus','loan_deduction','other_earning','other_deduction') or coalesce(p_amount,0)<=0 then raise exception 'Valid adjustment and positive amount required';end if;
 if exists(select 1 from public.transport_driver_month_closings where company_id=c and business_unit_id=b and operating_location_id=loc and employee_id=p_employee_id and month=m) then raise exception 'Driver month is posted and locked';end if;
 if p_trip_id is not null then
  t:=public.transport_financial_trip(p_trip_id);
  select d.employee_id into te from public.transport_drivers d where d.id=t.driver_id and d.company_id=c and d.business_unit_id=b
    and lower(coalesce(d.driver_type,''))='company' and d.supplier_id is null;
  if te is distinct from p_employee_id or date_trunc('month',t.trip_date)::date<>m then raise exception 'Selected Trip does not belong to this company driver/month';end if;
 end if;
 insert into public.transport_driver_month_adjustments(company_id,business_unit_id,operating_location_id,employee_id,month,kind,amount,note,trip_id)
 values(c,b,loc,p_employee_id,m,p_kind,round(p_amount,2),nullif(btrim(p_note),''),p_trip_id) returning id into rid;
 return rid;
end $$;

create or replace function public.transport_account_report_page(p_kind text,p_limit integer default 1000,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;
begin
 if not (public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier')) then raise exception 'Both Transport financial view permissions required';end if;
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission and active Company/Business Unit/branch required';end if;
 if p_kind='driver' and not public.has_module_permission(c,'accounting','view') then raise exception 'Accounting view permission required for payroll detail';end if;
 if p_kind='driver' then
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (
   select m.* from public.transport_driver_account_movements m
   where m.company_id=c and m.business_unit_id=b and m.operating_location_id=loc
     and exists(select 1 from public.transport_drivers d where d.company_id=c and d.business_unit_id=b and d.employee_id=m.employee_id
       and d.is_active and lower(coalesce(d.driver_type,''))='company' and d.supplier_id is null)
   order by m.event_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)
  ) q;
 elsif p_kind='vehicle' then
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (
   select m.* from public.transport_vehicle_account_movements m
   join public.transport_trips t on cardinality(m.trip_ids)=1 and t.id=m.trip_ids[1] and t.company_id=c and t.business_unit_id=b
   join public.transport_vehicle_ownership o on o.id=t.ownership_id and o.vehicle_id=m.account_id and o.company_id=c and o.business_unit_id=b
   where m.company_id=c and m.business_unit_id=b and m.operating_location_id=loc
     and lower(coalesce(o.owner_type,'')) in ('company','company_owned','owned','self')
   order by m.event_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)
  ) q;
 elsif p_kind='contributions' then
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (
   select x.* from public.transport_vehicle_contributions x
   join public.transport_trips t on t.id=x.trip_id and t.company_id=c and t.business_unit_id=b
   join public.transport_vehicle_ownership o on o.id=t.ownership_id and o.vehicle_id=x.account_id and o.company_id=c and o.business_unit_id=b
   where x.company_id=c and x.business_unit_id=b and x.operating_location_id=loc
     and lower(coalesce(o.owner_type,'')) in ('company','company_owned','owned','self')
     and (x.category<>'Driver pay' or public.has_module_permission(c,'accounting','view'))
   order by x.event_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)
  ) q;
 else raise exception 'Invalid account report kind';end if;
 return answer;
end $$;

comment on function public.transport_assert_company_employee_driver(uuid) is 'Hard boundary: Driver Khata is only for active company employee-drivers; supplier drivers remain supplier-rent operational data only.';
commit;
