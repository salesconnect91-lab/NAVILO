alter table public.inventory_costs drop constraint if exists inventory_costs_user_item_unique;
drop index if exists public.ux_warehouse_stock_company_location;
drop index if exists public.warehouse_stock_item_warehouse_godown_uidx;
create unique index if not exists inventory_costs_company_unit_item_uidx
  on public.inventory_costs(company_id,business_unit_id,item_id);
create unique index if not exists warehouse_stock_company_unit_location_uidx
  on public.warehouse_stock(company_id,business_unit_id,item_id,warehouse_id,godown_id);