begin;
-- Gari Hisaab follows the ownership snapshot saved on each Trip, never the
-- vehicle's current master ownership. Supplier-era trips therefore stay out
-- even if the same vehicle later becomes company-owned.
create or replace function public.transport_account_report_page(p_kind text,p_limit integer default 1000,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;
begin
 if not (public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier')) then raise exception 'Both Transport financial view permissions required';end if;
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission and active Company/Business Unit/branch required';end if;
 if p_kind='driver' and not public.has_module_permission(c,'accounting','view') then raise exception 'Accounting view permission required for payroll detail';end if;
 if p_kind='driver' then
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (select m.* from public.transport_driver_account_movements m where m.company_id=c and m.business_unit_id=b and m.operating_location_id=loc and exists(select 1 from public.employees e where e.id=m.employee_id and e.company_id=c) order by m.event_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)) q;
 elsif p_kind='vehicle' then
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (
   select m.* from public.transport_vehicle_account_movements m
   join public.transport_trips t on cardinality(m.trip_ids)=1 and t.id=m.trip_ids[1] and t.company_id=c and t.business_unit_id=b
   join public.transport_vehicle_ownership o on o.id=t.ownership_id and o.vehicle_id=m.account_id and o.company_id=c and o.business_unit_id=b
   where m.company_id=c and m.business_unit_id=b and m.operating_location_id=loc and lower(coalesce(o.owner_type,'')) in ('company','company_owned','owned','self')
   order by m.event_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)) q;
 elsif p_kind='contributions' then
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (
   select x.* from public.transport_vehicle_contributions x
   join public.transport_trips t on t.id=x.trip_id and t.company_id=c and t.business_unit_id=b
   join public.transport_vehicle_ownership o on o.id=t.ownership_id and o.vehicle_id=x.account_id and o.company_id=c and o.business_unit_id=b
   where x.company_id=c and x.business_unit_id=b and x.operating_location_id=loc and lower(coalesce(o.owner_type,'')) in ('company','company_owned','owned','self') and (x.category<>'Driver pay' or public.has_module_permission(c,'accounting','view'))
   order by x.event_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)) q;
 else raise exception 'Invalid account report kind';end if;
 return answer;
end $$;
revoke all on function public.transport_account_report_page(text,integer,integer) from public,anon;
grant execute on function public.transport_account_report_page(text,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
