begin;
create or replace function public.transport_document_trip_detail_query(p_side text,p_filters jsonb default '{}'::jsonb,p_limit integer default 1000,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;
begin
 if not public.transport_financial_read_allowed(p_side) then raise exception 'Transport financial side view permission required';end if;
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view and active branch required';end if;
 if jsonb_typeof(p_filters) is distinct from 'object' or octet_length(p_filters::text)>10000 then raise exception 'Invalid report filters';end if;
 if p_side is null or p_side not in ('customer','supplier') then raise exception 'Invalid document side';end if;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (
  select src.order_id,src.order_no,t.id trip_id,t.trip_no,t.trip_date,t.from_location,t.to_location,t.po_do_job_no,
   a.vehicle_no_snapshot vehicle_no,a.driver_name_snapshot driver_name,case when public.transport_financial_read_allowed('supplier') then a.owner_name_snapshot end owner_name,
   coalesce(a.vehicle_no_snapshot,'Unattributed') attribution_vehicle,
   coalesce(fin.base_amount,0) base_amount,coalesce(fin.charge_amount,0) charge_amount,coalesce(fin.tax_amount,0) tax_amount,coalesce(fin.total_amount,0) total_amount,
   coalesce(fin.charge_breakdown,'') charge_breakdown
  from public.transport_party_document_sources src join public.transport_trips t on t.id=any(src.trip_ids)
  join public.journal_entries j on j.id=src.journal_entry_id
  left join lateral(select * from public.transport_trip_assignments a where a.trip_id=t.id and a.created_at<=j.created_at and a.effective_at<=j.created_at and (a.ended_at is null or j.created_at<a.ended_at) order by a.effective_at desc limit 1) a on true
  left join lateral (
   select
    case when p_side='customer' then coalesce((select sum(sl.amount) from public.sales_service_lines sl where sl.order_id=src.order_id and sl.company_id=c and sl.business_unit_id=b),0)
         else coalesce((select sum(pl.amount) from public.purchase_service_lines pl where pl.order_id=src.order_id and pl.company_id=c and pl.business_unit_id=b),0) end base_amount,
    case when p_side='customer' then coalesce((select sum(ch.amount) from public.sales_order_charges ch where ch.order_id=src.order_id and ch.company_id=c and ch.business_unit_id=b),0)
         else coalesce((select sum(ch.amount) from public.purchase_order_charges ch where ch.order_id=src.order_id and ch.company_id=c and ch.business_unit_id=b),0) end charge_amount,
    case when p_side='customer' then coalesce((select sum(sl.amount*coalesce(sl.tax_percent,0)/100) from public.sales_service_lines sl where sl.order_id=src.order_id and sl.company_id=c and sl.business_unit_id=b),0)+coalesce((select sum(ch.amount*coalesce(ch.tax_percent,0)/100) from public.sales_order_charges ch where ch.order_id=src.order_id and ch.company_id=c and ch.business_unit_id=b),0)
         else coalesce((select sum(pl.amount*coalesce(pl.tax_percent,0)/100) from public.purchase_service_lines pl where pl.order_id=src.order_id and pl.company_id=c and pl.business_unit_id=b),0)+coalesce((select sum(ch.amount*coalesce(ch.tax_percent,0)/100) from public.purchase_order_charges ch where ch.order_id=src.order_id and ch.company_id=c and ch.business_unit_id=b),0) end tax_amount,
    case when p_side='customer' then coalesce((select so.total from public.sales_orders so where so.id=src.order_id and so.company_id=c and so.business_unit_id=b),0)
         else coalesce((select po.total from public.purchase_orders po where po.id=src.order_id and po.company_id=c and po.business_unit_id=b),0) end total_amount,
    case when p_side='customer' then coalesce((select string_agg(ch.charge_label||' '||to_char(ch.amount,'FM999,999,999,990.00'),' + ' order by ch.created_at,ch.id) from public.sales_order_charges ch where ch.order_id=src.order_id and ch.company_id=c and ch.business_unit_id=b),'')
         else coalesce((select string_agg(ch.charge_label||' '||to_char(ch.amount,'FM999,999,999,990.00'),' + ' order by ch.created_at,ch.id) from public.purchase_order_charges ch where ch.order_id=src.order_id and ch.company_id=c and ch.business_unit_id=b),'') end charge_breakdown
  ) fin on true
  where src.company_id=c and src.business_unit_id=b and src.operating_location_id=loc and src.side=p_side
   and (nullif(p_filters->>'party','') is null or src.party_id=(p_filters->>'party')::uuid)
   and (nullif(p_filters->>'to','') is null or src.order_date<=(p_filters->>'to')::date)
   and (coalesce(p_filters->>'search','')='' or position(lower(p_filters->>'search') in lower(concat_ws(' ',src.trip_no,src.order_no)))>0)
  order by src.order_id,t.id limit greatest(1,least(p_limit,1000)) offset greatest(p_offset,0)
 ) q;return answer;
end $$;
notify pgrst,'reload schema';
commit;