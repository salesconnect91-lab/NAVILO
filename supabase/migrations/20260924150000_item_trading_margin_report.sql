create or replace function public.report_item_trading_margin(p_from date default null,p_to date default null)
returns table(item_id uuid,category_name text,item_name text,grade text,size text,unit text,purchase_qty numeric,avg_purchase_rate numeric,purchase_value numeric,sales_qty numeric,avg_sale_rate numeric,sales_value numeric,rate_margin numeric,rate_margin_percent numeric,gross_margin numeric)
language sql stable security invoker set search_path='public','pg_temp' as $$
with pu as(select h.item_id,sum(h.qty) qty,sum(h.line_total) val from public.supplier_item_history_report h where h.company_id=public.current_company_id() and h.business_unit_id=public.current_business_unit_id() and (p_from is null or h.order_date>=p_from) and (p_to is null or h.order_date<=p_to) group by h.item_id),
sa as(select h.item_id,sum(h.qty) qty,sum(h.line_total) val from public.customer_item_history_report h where h.company_id=public.current_company_id() and h.business_unit_id=public.current_business_unit_id() and (p_from is null or h.order_date>=p_from) and (p_to is null or h.order_date<=p_to) group by h.item_id)
select i.id,coalesce(c.name,'Unspecified'),i.name,i.grade,i.size,i.unit,coalesce(pu.qty,0),case when coalesce(pu.qty,0)<>0 then round(pu.val/pu.qty,4) else 0 end,coalesce(pu.val,0),coalesce(sa.qty,0),case when coalesce(sa.qty,0)<>0 then round(sa.val/sa.qty,4) else 0 end,coalesce(sa.val,0),
case when coalesce(sa.qty,0)<>0 then round(sa.val/sa.qty,4) else 0 end-case when coalesce(pu.qty,0)<>0 then round(pu.val/pu.qty,4) else 0 end,
case when coalesce(pu.qty,0)<>0 and pu.val<>0 then round(((case when coalesce(sa.qty,0)<>0 then sa.val/sa.qty else 0 end)-(pu.val/pu.qty))*100/(pu.val/pu.qty),2) else 0 end,
coalesce(sa.val,0)-case when coalesce(sa.qty,0)<>0 and coalesce(pu.qty,0)<>0 then sa.qty*(pu.val/pu.qty) else 0 end
from public.items i left join public.categories c on c.id=i.category_id left join pu on pu.item_id=i.id left join sa on sa.item_id=i.id
where i.company_id=public.current_company_id() and (coalesce(pu.qty,0)<>0 or coalesce(sa.qty,0)<>0)
order by coalesce(c.name,'Unspecified'),i.name,i.size
$$;
revoke all on function public.report_item_trading_margin(date,date) from public,anon;
grant execute on function public.report_item_trading_margin(date,date) to authenticated;