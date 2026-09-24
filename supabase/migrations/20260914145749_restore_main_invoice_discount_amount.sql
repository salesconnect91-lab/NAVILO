alter table public.sales_orders add column if not exists discount_amount numeric not null default 0 check (discount_amount >= 0);
alter table public.purchase_orders add column if not exists discount_amount numeric not null default 0 check (discount_amount >= 0);
