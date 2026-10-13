-- Check permissions once before reading the already protected combined sources.
-- These reports expose no rows outside the active company / unit / location.
create function public.transport_party_aging_query(p_side text,p_limit integer default 1000,p_offset integer default 0)
returns jsonb language plpgsql stable security definer
set search_path=public,pg_temp set plan_cache_mode=force_custom_plan set work_mem='64MB' as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;
begin
 if auth.uid() is null or c is null or b is null or loc is null or p_side is null or p_side not in('customer','supplier')
 or not public.has_module_permission(c,'accounting','view') or not public.transport_financial_read_allowed(p_side)
 then raise exception 'Accounting and financial-side view permission with active workspace required';end if;
 if p_side='customer' then
 select coalesce(jsonb_agg(q.row),'[]') into answer from(
 select to_jsonb(a) row from public.customer_receivable_aging_report a
 where a.company_id=c and a.business_unit_id=b and a.operating_location_id=loc
 order by a.invoice_date desc,a.report_row_id
 limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0))q;
 else
 select coalesce(jsonb_agg(q.row),'[]') into answer from(
 select to_jsonb(a) row from public.supplier_payable_aging_report a
 where a.company_id=c and a.business_unit_id=b and a.operating_location_id=loc
 order by a.invoice_date desc,a.report_row_id
 limit greatest(1,least(coalesce(p_limit,1000),1000)) offset greatest(coalesce(p_offset,0),0))q;
 end if;
 return answer;
end $$;
revoke all on function public.transport_party_aging_query(text,integer,integer) from public,anon;
grant execute on function public.transport_party_aging_query(text,integer,integer) to authenticated;

-- Reuse the authorization/scope results already computed by the report function,
-- rather than executing the permission helper separately for every source Trip.
do $read$ declare body text; begin
 select pg_get_functiondef('public.transport_trip_report(text,integer,integer,jsonb)'::regprocedure) into body;
 body:=replace(body,'where public.transport_financial_read_allowed(''customer'') and l.trip_id=r.id','where cv and l.trip_id=r.id');
 body:=replace(body,'where public.transport_financial_read_allowed(''supplier'') and l.trip_id=r.id','where sv and l.trip_id=r.id');
 body:=replace(body,'d.operating_location_id=public.current_operating_location_id()','d.operating_location_id=loc');
 body:=replace(body,'from (select masked.* from register_source fr cross join',
 'from (select fr.* from register_source fr where cv and sv union all select masked.* from register_source fr cross join');
 body:=replace(body,'where fr.company_id=c and fr.business_unit_id=b) r',
 'where not(cv and sv) and fr.company_id=c and fr.business_unit_id=b) r');
 execute body;
end $read$;
notify pgrst,'reload schema';
