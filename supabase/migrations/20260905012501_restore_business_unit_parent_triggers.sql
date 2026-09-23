do $do$
declare r record;
begin
 for r in select * from (values
 ('sales_order_lines','sales_orders','order_id'),('sales_order_charges','sales_orders','order_id'),
 ('sales_order_hawala_invoices','sales_orders','sales_order_id'),('sales_order_hawala_invoices','consolidated_sales_invoices','hawala_invoice_id'),
 ('sales_consolidation_invoices','sales_consolidations','consolidation_id'),('sales_consolidation_invoices','sales_orders','sales_order_id'),
 ('consolidated_sales_invoice_lines','consolidated_sales_invoices','invoice_id'),('consolidated_sales_invoice_charges','consolidated_sales_invoices','invoice_id'),
 ('purchase_order_lines','purchase_orders','order_id'),('purchase_order_consolidated_invoices','purchase_orders','purchase_order_id'),
 ('purchase_order_consolidated_invoices','consolidated_purchase_invoices','consolidated_invoice_id'),
 ('consolidated_purchase_invoice_lines','consolidated_purchase_invoices','invoice_id'),('consolidated_purchase_invoice_charges','consolidated_purchase_invoices','invoice_id'),
 ('work_order_lines','work_orders','order_id'),('journal_lines','journal_entries','entry_id'),('ledgers','journal_entries','journal_entry_id'),
 ('party_ledgers','journal_entries','journal_entry_id'),('invoice_payment_allocations','sales_orders','sales_order_id'),
 ('purchase_payment_allocations','purchase_orders','purchase_order_id'),('return_note_lines','return_notes','note_id'),
 ('bank_reconciliation_items','bank_reconciliations','reconciliation_id'),('fixed_asset_depreciation','fixed_assets','asset_id')
 ) x(child_table,parent_table,parent_fk)
 loop
  if to_regclass('public.'||r.child_table) is not null and to_regclass('public.'||r.parent_table) is not null then
   execute format('drop trigger if exists %I on public.%I','trg_00_bu_parent_'||r.parent_table,r.child_table);
   execute format('create trigger %I before insert or update on public.%I for each row execute function public.propagate_business_unit_from_parent(%L,%L)','trg_00_bu_parent_'||r.parent_table,r.child_table,r.parent_table,r.parent_fk);
  end if;
 end loop;
end $do$;