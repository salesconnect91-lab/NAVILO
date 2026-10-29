-- Cover verified foreign keys on high-use sales, purchase, stock and journal tables.
-- Index-only change: does not alter posted-record guards or financial data.
CREATE INDEX IF NOT EXISTS idx_journal_entries_monthly_profit_closure_id
  ON public.journal_entries (monthly_profit_closure_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_currency_code
  ON public.purchase_orders (currency_code);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_transport_register_conversion_id
  ON public.purchase_orders (transport_register_conversion_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_currency_code
  ON public.sales_orders (currency_code);
CREATE INDEX IF NOT EXISTS idx_sales_orders_transport_billing_origin_id
  ON public.sales_orders (transport_billing_origin_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_transport_register_conversion_id
  ON public.sales_orders (transport_register_conversion_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_bin_id
  ON public.stock_movements (bin_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_inventory_document_id
  ON public.stock_movements (inventory_document_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_lot_id
  ON public.stock_movements (lot_id);
