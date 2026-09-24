create or replace function public.report_stock_trading_control(p_from date default null,p_to date default null)
returns table(item_id uuid,category_name text,item_name text,grade text,size text,unit text,godown text,opening_qty numeric,purchase_qty numeric,other_in_qty numeric,sales_qty numeric,other_out_qty numeric,net_movement numeric,closing_qty numeric)
language sql stable security invoker set search_path='public','pg_temp' as $$
with p as(select coalesce(p_from,current_date) f,coalesce(p_to,current_date) t),
base as(
 select sm.item_id,i.category_id,c.name category_name,i.name item_name,i.grade,i.size,i.unit,coalesce(g.name,sm.godown,'Main') godown,
 sum(case when sm.created_at::date<(select f from p) then case when sm.type in('in','sale_return') then sm.qty when sm.type in('out','purchase_return') then -sm.qty else coalesce(sm.resulting_qty,0)-coalesce(sm.previous_qty,0) end else 0 end) opening_qty,
 sum(case when sm.created_at::date between (select f from p) and (select t from p) and sm.type in('in','sale_return') and (coalesce(sm.reference,'') ilike '%purchase%' or coalesce(sm.source_type,'') ilike '%purchase%') then sm.qty else 0 end) purchase_qty,
 sum(case when sm.created_at::date between (select f from p) and (select t from p) and sm.type in('in','sale_return') and not(coalesce(sm.reference,'') ilike '%purchase%' or coalesce(sm.source_type,'') ilike '%purchase%') then sm.qty else 0 end) other_in_qty,
 sum(case when sm.created_at::date between (select f from p) and (select t from p) and sm.type in('out','purchase_return') and (coalesce(sm.reference,'') ilike '%sale%' or coalesce(sm.source_type,'') ilike '%sale%') then sm.qty else 0 end) sales_qty,
 sum(case when sm.created_at::date between (select f from p) and (select t from p) and sm.type in('out','purchase_return') and not(coalesce(sm.reference,'') ilike '%sale%' or coalesce(sm.source_type,'') ilike '%sale%') then sm.qty else 0 end) other_out_qty,
 sum(case when sm.created_at::date between (select f from p) and (select t from p) then case when sm.type in('in','sale_return') then sm.qty when sm.type in('out','purchase_return') then -sm.qty else coalesce(sm.resulting_qty,0)-coalesce(sm.previous_qty,0) end else 0 end) net_movement
 from public.stock_movements sm join public.items i on i.id=sm.item_id and i.company_id=sm.company_id left join public.categories c on c.id=i.category_id left join public.godowns g on g.id=sm.godown_id and g.company_id=sm.company_id
 where sm.company_id=public.current_company_id() and sm.business_unit_id=public.current_business_unit_id() and sm.created_at::date<=(select t from p)
 group by sm.item_id,i.category_id,c.name,i.name,i.grade,i.size,i.unit,coalesce(g.name,sm.godown,'Main'))
select item_id,coalesce(category_name,'Unspecified'),item_name,grade,size,unit,godown,opening_qty,purchase_qty,other_in_qty,sales_qty,other_out_qty,net_movement,opening_qty+net_movement from base
order by coalesce(category_name,'Unspecified'),item_name,size,godown
$$;
revoke all on function public.report_stock_trading_control(date,date) from public,anon;
grant execute on function public.report_stock_trading_control(date,date) to authenticated;