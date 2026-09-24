-- Harden Daily Stock & Trading classification using structured source links first.
-- Legacy source_document rows fall back to matching posted order numbers; returns remain separate other in/out.
create or replace function public.report_stock_trading_control(p_from date default null,p_to date default null)
returns table(item_id uuid,category_name text,item_name text,grade text,size text,unit text,godown text,opening_qty numeric,purchase_qty numeric,other_in_qty numeric,sales_qty numeric,other_out_qty numeric,net_movement numeric,closing_qty numeric)
language sql stable security invoker set search_path='public','pg_temp' as $$
with p as(select coalesce(p_from,current_date) f,coalesce(p_to,current_date) t),
m as(
 select sm.*,case
  when sm.type='sale_return' then 'sale_return'
  when sm.type='purchase_return' then 'purchase_return'
  when sm.type='in' and (sm.source_type='purchase_invoice' or exists(select 1 from public.purchase_orders po where po.company_id=sm.company_id and (po.id=sm.source_id or po.order_no=sm.reference))) then 'purchase'
  when sm.type='out' and (sm.source_type='sales_invoice' or exists(select 1 from public.sales_orders so where so.company_id=sm.company_id and (so.id=sm.source_id or so.order_no=sm.reference))) then 'sale'
  else 'other' end movement_class
 from public.stock_movements sm
 where sm.company_id=public.current_company_id() and sm.business_unit_id=public.current_business_unit_id() and sm.created_at::date<=(select t from p)
),base as(
 select m.item_id,c.name category_name,i.name item_name,i.grade,i.size,i.unit,coalesce(g.name,m.godown,'Main') godown,
 sum(case when m.created_at::date<(select f from p) then case when m.type in('in','sale_return') then m.qty when m.type in('out','purchase_return') then -m.qty else coalesce(m.resulting_qty,0)-coalesce(m.previous_qty,0) end else 0 end) opening_qty,
 sum(case when m.created_at::date between (select f from p) and (select t from p) and m.movement_class='purchase' then m.qty else 0 end) purchase_qty,
 sum(case when m.created_at::date between (select f from p) and (select t from p) and m.type in('in','sale_return') and m.movement_class<>'purchase' then m.qty else 0 end) other_in_qty,
 sum(case when m.created_at::date between (select f from p) and (select t from p) and m.movement_class='sale' then m.qty else 0 end) sales_qty,
 sum(case when m.created_at::date between (select f from p) and (select t from p) and m.type in('out','purchase_return') and m.movement_class<>'sale' then m.qty else 0 end) other_out_qty,
 sum(case when m.created_at::date between (select f from p) and (select t from p) then case when m.type in('in','sale_return') then m.qty when m.type in('out','purchase_return') then -m.qty else coalesce(m.resulting_qty,0)-coalesce(m.previous_qty,0) end else 0 end) net_movement
 from m join public.items i on i.id=m.item_id and i.company_id=m.company_id left join public.categories c on c.id=i.category_id left join public.godowns g on g.id=m.godown_id and g.company_id=m.company_id
 group by m.item_id,c.name,i.name,i.grade,i.size,i.unit,coalesce(g.name,m.godown,'Main'))
select item_id,coalesce(category_name,'Unspecified'),item_name,grade,size,unit,godown,opening_qty,purchase_qty,other_in_qty,sales_qty,other_out_qty,net_movement,opening_qty+net_movement from base
order by coalesce(category_name,'Unspecified'),item_name,size,godown
$$;
revoke all on function public.report_stock_trading_control(date,date) from public,anon;
grant execute on function public.report_stock_trading_control(date,date) to authenticated;