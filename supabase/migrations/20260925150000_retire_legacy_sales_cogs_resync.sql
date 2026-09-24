-- post_sales_invoice_core already prices its journal COGS with
-- get_inventory_avg_cost(item_id). The older after-post trigger tries to
-- reprice that posted journal against items.cost, including min(uuid), and
-- can abort an otherwise balanced posting. No existing entries are changed.
drop trigger if exists trg_sync_sales_inventory_cogs on public.sales_orders;
revoke execute on function public.sync_sales_inventory_cogs() from public, anon, authenticated;
