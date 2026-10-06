begin;
-- Remove the abandoned Gondal-specific bookkeeping import path.
-- Preserve the canonical Trip-based Transport implementation and historical evidence.
drop function if exists public.transport_preview_owned_vehicle_sales_batch(jsonb);
drop function if exists public.transport_import_owned_vehicle_sales_batch(jsonb);
drop view if exists public.transport_vehicle_bookkeeping_contributions;
drop table if exists public.transport_owned_vehicle_sales_import_sources;

create or replace function public.transport_account_report_page(p_kind text,p_limit integer default 1000,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;
begin
 if not (public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier')) then raise exception 'Both Transport financial view permissions required';end if;
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission and active Company/Business Unit/branch required';end if;
 if p_kind='driver' and not public.has_module_permission(c,'accounting','view') then raise exception 'Accounting view permission required for payroll detail';end if;
 if p_kind='driver' then
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (select * from public.transport_driver_account_movements where company_id=c and business_unit_id=b and operating_location_id=loc order by event_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)) q;
 elsif p_kind='vehicle' then
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (select * from public.transport_vehicle_account_movements where company_id=c and business_unit_id=b and operating_location_id=loc order by event_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)) q;
 elsif p_kind='contributions' then
  select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (select * from public.transport_vehicle_contributions where company_id=c and business_unit_id=b and operating_location_id=loc and (category<>'Driver pay' or public.has_module_permission(c,'accounting','view')) order by event_id limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0)) q;
 else raise exception 'Invalid account report kind';end if;
 return answer;
end $$;
revoke all on function public.transport_account_report_page(text,integer,integer) from public,anon;
grant execute on function public.transport_account_report_page(text,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
