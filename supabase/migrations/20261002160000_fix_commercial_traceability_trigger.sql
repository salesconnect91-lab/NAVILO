-- Fix polymorphic traceability trigger: never reference NEW fields that do not exist on the firing table.
create or replace function public.sync_commercial_transaction_link()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_module text;
begin
  if tg_table_name='journal_entries' then
    if new.source_document_id is not null then
      v_module:=case when new.source_module in ('sales','purchase','inventory','production','transport','accounting') then new.source_module else 'accounting' end;
      perform public.record_transaction_link(new.company_id,new.business_unit_id,v_module,coalesce(new.source_document_type,'source_document'),new.source_document_id,'accounting','journal_entry',new.id,'posted_as');
    end if;
  elsif tg_table_name='return_notes' then
    if new.sales_order_id is not null then perform public.record_transaction_link(new.company_id,new.business_unit_id,'sales','sales_invoice',new.sales_order_id,'accounting','return_note',new.id,'returned_by'); end if;
    if new.purchase_order_id is not null then perform public.record_transaction_link(new.company_id,new.business_unit_id,'purchase','purchase_invoice',new.purchase_order_id,'accounting','return_note',new.id,'returned_by'); end if;
    if new.journal_entry_id is not null then perform public.record_transaction_link(new.company_id,new.business_unit_id,'accounting','return_note',new.id,'accounting','journal_entry',new.journal_entry_id,'posted_as'); end if;
  elsif tg_table_name='invoice_payment_allocations' then
    perform public.record_transaction_link(new.company_id,new.business_unit_id,'sales','sales_invoice',new.sales_order_id,'accounting','journal_entry',new.journal_entry_id,'settled_by');
  elsif tg_table_name='purchase_payment_allocations' then
    perform public.record_transaction_link(new.company_id,new.business_unit_id,'purchase','purchase_invoice',new.purchase_order_id,'accounting','journal_entry',new.journal_entry_id,'settled_by');
  elsif tg_table_name='stock_movements' then
    if new.source_id is not null then
      v_module:=case when lower(coalesce(new.source_type,'')) like '%sales%' then 'sales' when lower(coalesce(new.source_type,'')) like '%purchase%' then 'purchase' when lower(coalesce(new.source_type,'')) like '%work%' or lower(coalesce(new.source_type,'')) like '%production%' then 'production' else 'inventory' end;
      perform public.record_transaction_link(new.company_id,new.business_unit_id,v_module,coalesce(new.source_type,'source_document'),new.source_id,'inventory','stock_movement',new.id,'moved_stock');
    end if;
  elsif tg_table_name='gate_passes' then
    if new.sales_order_id is not null then perform public.record_transaction_link(new.company_id,new.business_unit_id,'sales','sales_invoice',new.sales_order_id,'production','gate_pass',new.id,'dispatched_by'); end if;
    if new.order_book_header_id is not null then perform public.record_transaction_link(new.company_id,new.business_unit_id,'sales','order_book',new.order_book_header_id,'production','gate_pass',new.id,'dispatched_by'); end if;
  elsif tg_table_name='order_book_fulfillments' then
    v_module:=case when lower(coalesce(new.document_type,'')) like '%purchase%' then 'purchase' else 'sales' end;
    perform public.record_transaction_link(new.company_id,new.business_unit_id,v_module,'order_book_commitment',new.commitment_id,v_module,new.document_type,new.document_id,'fulfilled_by');
  elsif tg_table_name='sales_order_lines' then
    if new.order_book_commitment_id is not null then perform public.record_transaction_link(new.company_id,new.business_unit_id,'sales','order_book_commitment',new.order_book_commitment_id,'sales','sales_invoice',new.order_id,'fulfilled_by'); end if;
  elsif tg_table_name='purchase_order_lines' then
    if new.order_book_commitment_id is not null then perform public.record_transaction_link(new.company_id,new.business_unit_id,'purchase','order_book_commitment',new.order_book_commitment_id,'purchase','purchase_invoice',new.order_id,'fulfilled_by'); end if;
  end if;
  return new;
end $$;