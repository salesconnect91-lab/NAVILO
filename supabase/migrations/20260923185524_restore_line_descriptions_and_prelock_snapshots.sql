begin;

-- Both columns exist in the read-only production catalog and are used by the
-- current UI and posting functions, but their baseline creator was absent from
-- the repository migration chain.
alter table public.sales_order_lines
  add column if not exists description text;

alter table public.purchase_order_lines
  add column if not exists description text;

-- Capture line display names while the parent is still draft.  The previous
-- AFTER-status triggers attempted to update child rows only after the parent
-- became posted, where the posted-line immutability triggers correctly denied
-- the update and rolled back the whole posting transaction.
drop trigger if exists sales_order_line_capture_name_snapshots on public.sales_orders;
create trigger sales_order_line_capture_name_snapshots
before insert or update of status on public.sales_orders
for each row execute function public.capture_sales_order_line_name_snapshots();

drop trigger if exists purchase_order_line_capture_name_snapshots on public.purchase_orders;
create trigger purchase_order_line_capture_name_snapshots
before insert or update of status on public.purchase_orders
for each row execute function public.capture_purchase_order_line_name_snapshots();

notify pgrst, 'reload schema';

commit;
