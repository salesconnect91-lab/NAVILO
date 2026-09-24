create or replace view public.daily_stock_trading_summary with (security_invoker=true) as
select sm.company_id,sm.business_unit_id,sm.operating_location_id,(sm.created_at at time zone 'UTC')::date as movement_date,
 i.id item_id,i.name item_name,i.grade,i.size,i.unit,i.category_id,c.name category_name,sm.warehouse_id,sm.godown_id,coalesce(g.name,sm.godown,'Main') godown,
 sum(case when sm.type in('in','sale_return') then sm.qty else 0 end) stock_in,
 sum(case when sm.type in('out','purchase_return') then sm.qty else 0 end) stock_out,
 sum(case when sm.type in('in','sale_return') then sm.qty when sm.type in('out','purchase_return') then -sm.qty else 0 end) net_movement,
 sum(case when sm.type in('in','sale_return') and (coalesce(sm.reference,'') ilike '%purchase%' or coalesce(sm.source_type,'') ilike '%purchase%') then sm.qty else 0 end) purchase_qty,
 sum(case when sm.type in('out','purchase_return') and (coalesce(sm.reference,'') ilike '%sale%' or coalesce(sm.source_type,'') ilike '%sale%') then sm.qty else 0 end) sales_qty
from public.stock_movements sm join public.items i on i.id=sm.item_id and i.company_id=sm.company_id left join public.categories c on c.id=i.category_id left join public.godowns g on g.id=sm.godown_id and g.company_id=sm.company_id
group by sm.company_id,sm.business_unit_id,sm.operating_location_id,(sm.created_at at time zone 'UTC')::date,i.id,i.name,i.grade,i.size,i.unit,i.category_id,c.name,sm.warehouse_id,sm.godown_id,coalesce(g.name,sm.godown,'Main');
revoke all on public.daily_stock_trading_summary from anon;
grant select on public.daily_stock_trading_summary to authenticated;