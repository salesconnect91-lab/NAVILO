create or replace function public.transport_trip_audit_report(p_trip_no text,p_limit integer default 500,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();n text:=upper(btrim(p_trip_no));answer jsonb;
begin
 if not (public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier'))
 then raise exception 'Both Transport financial view permissions required';end if;
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view')
 then raise exception 'Transport view permission and active Company/Business Unit/branch required';end if;
 if n is null or length(n) not between 1 and 120 then raise exception 'Enter an exact Trip No';end if;
 with filtered as materialized (
  select a.id,a.event_type,a.old_data,a.new_data,a.changed_by,a.actor_id,a.changed_at,a.occurred_at,a.reason,a.trip_no,a.correlation_id,
   coalesce(u.email,a.changed_by::text,a.actor_id::text,'Not recorded') actor_name,
   coalesce(a.changed_at,a.occurred_at) event_at,
   coalesce(a.source,a.new_data->>'source',a.old_data->>'source','Not recorded') source,
   coalesce(a.reason,a.new_data->>'reason',a.old_data->>'reason') event_reason
  from public.transport_trip_audit a left join public.user_profiles u on u.id=coalesce(a.changed_by,a.actor_id)
  where a.company_id=c and a.business_unit_id=b and a.operating_location_id=loc and upper(btrim(a.trip_no))=n
 ), page as (
  select * from filtered order by event_at asc nulls first,id asc
  limit greatest(1,least(coalesce(p_limit,500),500)) offset greatest(coalesce(p_offset,0),0)
 ), ids as (
  select distinct v.value#>>'{}' id from filtered a cross join lateral jsonb_each(case when jsonb_typeof(a.old_data)='object' then a.old_data else '{}'::jsonb end) v
  union
  select distinct v.value#>>'{}' from filtered a cross join lateral jsonb_each(case when jsonb_typeof(a.new_data)='object' then a.new_data else '{}'::jsonb end) v
 ), labels as (
  select id::text id,name label from public.customers where company_id=c and id::text in(select id from ids)
  union all select id::text,name from public.suppliers where company_id=c and id::text in(select id from ids)
  union all select id::text,driver_name from public.transport_drivers where company_id=c and business_unit_id=b and id::text in(select id from ids)
  union all select id::text,vehicle_no from public.transport_vehicles where company_id=c and business_unit_id=b and id::text in(select id from ids)
  union all select id::text,name from public.transport_locations where company_id=c and business_unit_id=b and id::text in(select id from ids)
  union all select id::text,name from public.transport_truck_types where company_id=c and business_unit_id=b and id::text in(select id from ids)
  union all select id::text,name from public.employees where company_id=c and id::text in(select id from ids)
 )
 select jsonb_build_object(
  'trip_no',n,
  'rows',coalesce((select jsonb_agg(to_jsonb(p) order by p.event_at asc nulls first,p.id) from page p),'[]'::jsonb),
  'count',(select count(*) from filtered),
  'labels',coalesce((select jsonb_object_agg(id,label) from labels),'{}'::jsonb),
  'deleted',exists(select 1 from filtered) and not exists(
    select 1 from public.transport_trips t where t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc and upper(btrim(t.trip_no))=n
  ),
  'snapshot',coalesce((select coalesce(nullif(a.new_data,'{}'),a.old_data) from filtered a
    where coalesce(a.new_data,a.old_data) ? 'trip_no' order by a.event_at desc,a.id desc limit 1),'{}'::jsonb)
 ) into answer;
 return answer;
end $$;
revoke all on function public.transport_trip_audit_report(text,integer,integer) from public,anon;
grant execute on function public.transport_trip_audit_report(text,integer,integer) to authenticated;
notify pgrst,'reload schema';