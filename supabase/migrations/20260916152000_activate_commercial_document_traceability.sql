begin;

-- The link table is system-maintained audit evidence, not user-editable data.
revoke all on public.transaction_links from anon;
revoke insert, update, delete on public.transaction_links from authenticated;
grant select on public.transaction_links to authenticated;

create or replace function public.record_transaction_link(
  p_company_id uuid, p_business_unit_id uuid,
  p_source_module text, p_source_type text, p_source_id uuid,
  p_target_module text, p_target_type text, p_target_id uuid,
  p_relation_type text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_company_id is null or p_business_unit_id is null or p_source_id is null or p_target_id is null then return; end if;
  if nullif(btrim(p_source_type),'') is null or nullif(btrim(p_target_type),'') is null then return; end if;
  insert into public.transaction_links(company_id,business_unit_id,source_module,source_type,source_id,target_module,target_type,target_id,relation_type)
  values(p_company_id,p_business_unit_id,lower(p_source_module),lower(p_source_type),p_source_id,lower(p_target_module),lower(p_target_type),p_target_id,lower(p_relation_type))
  on conflict(company_id,source_type,source_id,target_type,target_id,relation_type) do nothing;
end;
$$;
revoke all on function public.record_transaction_link(uuid,uuid,text,text,uuid,text,text,uuid,text) from public,anon,authenticated;

create or replace function public.sync_commercial_transaction_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_module text;
begin
  if tg_table_name='journal_entries' and new.source_document_id is not null then
    v_module:=case when new.source_module in ('sales','purchase','inventory','production','transport','accounting') then new.source_module else 'accounting' end;
    perform public.record_transaction_link(new.company_id,new.business_unit_id,v_module,coalesce(new.source_document_type,'source_document'),new.source_document_id,'accounting','journal_entry',new.id,'posted_as');
  elsif tg_table_name='return_notes' then
    if new.sales_order_id is not null then perform public.record_transaction_link(new.company_id,new.business_unit_id,'sales','sales_invoice',new.sales_order_id,'accounting','return_note',new.id,'returned_by'); end if;
    if new.purchase_order_id is not null then perform public.record_transaction_link(new.company_id,new.business_unit_id,'purchase','purchase_invoice',new.purchase_order_id,'accounting','return_note',new.id,'returned_by'); end if;
    if new.journal_entry_id is not null then perform public.record_transaction_link(new.company_id,new.business_unit_id,'accounting','return_note',new.id,'accounting','journal_entry',new.journal_entry_id,'posted_as'); end if;
  elsif tg_table_name='invoice_payment_allocations' then
    perform public.record_transaction_link(new.company_id,new.business_unit_id,'sales','sales_invoice',new.sales_order_id,'accounting','journal_entry',new.journal_entry_id,'settled_by');
  elsif tg_table_name='purchase_payment_allocations' then
    perform public.record_transaction_link(new.company_id,new.business_unit_id,'purchase','purchase_invoice',new.purchase_order_id,'accounting','journal_entry',new.journal_entry_id,'settled_by');
  elsif tg_table_name='stock_movements' and new.source_id is not null then
    v_module:=case
      when lower(coalesce(new.source_type,'')) like '%sales%' then 'sales'
      when lower(coalesce(new.source_type,'')) like '%purchase%' then 'purchase'
      when lower(coalesce(new.source_type,'')) like '%work%' or lower(coalesce(new.source_type,'')) like '%production%' then 'production'
      else 'inventory' end;
    perform public.record_transaction_link(new.company_id,new.business_unit_id,v_module,coalesce(new.source_type,'source_document'),new.source_id,'inventory','stock_movement',new.id,'moved_stock');
  elsif tg_table_name='gate_passes' then
    if new.sales_order_id is not null then perform public.record_transaction_link(new.company_id,new.business_unit_id,'sales','sales_invoice',new.sales_order_id,'production','gate_pass',new.id,'dispatched_by'); end if;
    if new.order_book_header_id is not null then perform public.record_transaction_link(new.company_id,new.business_unit_id,'sales','order_book',new.order_book_header_id,'production','gate_pass',new.id,'dispatched_by'); end if;
  elsif tg_table_name='order_book_fulfillments' then
    v_module:=case when lower(coalesce(new.document_type,'')) like '%purchase%' then 'purchase' else 'sales' end;
    perform public.record_transaction_link(new.company_id,new.business_unit_id,v_module,'order_book_commitment',new.commitment_id,v_module,new.document_type,new.document_id,'fulfilled_by');
  elsif tg_table_name='sales_order_lines' and new.order_book_commitment_id is not null then
    perform public.record_transaction_link(new.company_id,new.business_unit_id,'sales','order_book_commitment',new.order_book_commitment_id,'sales','sales_invoice',new.order_id,'fulfilled_by');
  elsif tg_table_name='purchase_order_lines' and new.order_book_commitment_id is not null then
    perform public.record_transaction_link(new.company_id,new.business_unit_id,'purchase','order_book_commitment',new.order_book_commitment_id,'purchase','purchase_invoice',new.order_id,'fulfilled_by');
  end if;
  return new;
end;
$$;
revoke all on function public.sync_commercial_transaction_link() from public,anon,authenticated;

drop trigger if exists trg_sync_commercial_link_journal on public.journal_entries;
create trigger trg_sync_commercial_link_journal after insert or update of source_document_id,status on public.journal_entries for each row execute function public.sync_commercial_transaction_link();
drop trigger if exists trg_sync_commercial_link_return on public.return_notes;
create trigger trg_sync_commercial_link_return after insert or update of journal_entry_id,status on public.return_notes for each row execute function public.sync_commercial_transaction_link();
drop trigger if exists trg_sync_commercial_link_sales_payment on public.invoice_payment_allocations;
create trigger trg_sync_commercial_link_sales_payment after insert or update on public.invoice_payment_allocations for each row execute function public.sync_commercial_transaction_link();
drop trigger if exists trg_sync_commercial_link_purchase_payment on public.purchase_payment_allocations;
create trigger trg_sync_commercial_link_purchase_payment after insert or update on public.purchase_payment_allocations for each row execute function public.sync_commercial_transaction_link();
drop trigger if exists trg_sync_commercial_link_stock on public.stock_movements;
create trigger trg_sync_commercial_link_stock after insert or update of source_id,source_type on public.stock_movements for each row execute function public.sync_commercial_transaction_link();
drop trigger if exists trg_sync_commercial_link_gate on public.gate_passes;
create trigger trg_sync_commercial_link_gate after insert or update of sales_order_id,order_book_header_id,status on public.gate_passes for each row execute function public.sync_commercial_transaction_link();
drop trigger if exists trg_sync_commercial_link_fulfillment on public.order_book_fulfillments;
create trigger trg_sync_commercial_link_fulfillment after insert or update on public.order_book_fulfillments for each row execute function public.sync_commercial_transaction_link();
drop trigger if exists trg_sync_commercial_link_sales_line on public.sales_order_lines;
create trigger trg_sync_commercial_link_sales_line after insert or update of order_book_commitment_id on public.sales_order_lines for each row execute function public.sync_commercial_transaction_link();
drop trigger if exists trg_sync_commercial_link_purchase_line on public.purchase_order_lines;
create trigger trg_sync_commercial_link_purchase_line after insert or update of order_book_commitment_id on public.purchase_order_lines for each row execute function public.sync_commercial_transaction_link();

-- Backfill the chain for existing production transactions.
insert into public.transaction_links(company_id,business_unit_id,source_module,source_type,source_id,target_module,target_type,target_id,relation_type)
select company_id,business_unit_id,case when source_module in ('sales','purchase','inventory','production','transport','accounting') then source_module else 'accounting' end,
       coalesce(source_document_type,'source_document'),source_document_id,'accounting','journal_entry',id,'posted_as'
from public.journal_entries where source_document_id is not null and company_id is not null and business_unit_id is not null
on conflict do nothing;
insert into public.transaction_links(company_id,business_unit_id,source_module,source_type,source_id,target_module,target_type,target_id,relation_type)
select company_id,business_unit_id,'sales','sales_invoice',sales_order_id,'accounting','return_note',id,'returned_by' from public.return_notes where sales_order_id is not null and company_id is not null and business_unit_id is not null on conflict do nothing;
insert into public.transaction_links(company_id,business_unit_id,source_module,source_type,source_id,target_module,target_type,target_id,relation_type)
select company_id,business_unit_id,'purchase','purchase_invoice',purchase_order_id,'accounting','return_note',id,'returned_by' from public.return_notes where purchase_order_id is not null and company_id is not null and business_unit_id is not null on conflict do nothing;
insert into public.transaction_links(company_id,business_unit_id,source_module,source_type,source_id,target_module,target_type,target_id,relation_type)
select company_id,business_unit_id,'accounting','return_note',id,'accounting','journal_entry',journal_entry_id,'posted_as' from public.return_notes where journal_entry_id is not null and company_id is not null and business_unit_id is not null on conflict do nothing;
insert into public.transaction_links(company_id,business_unit_id,source_module,source_type,source_id,target_module,target_type,target_id,relation_type)
select company_id,business_unit_id,'sales','sales_invoice',sales_order_id,'accounting','journal_entry',journal_entry_id,'settled_by' from public.invoice_payment_allocations where company_id is not null and business_unit_id is not null on conflict do nothing;
insert into public.transaction_links(company_id,business_unit_id,source_module,source_type,source_id,target_module,target_type,target_id,relation_type)
select company_id,business_unit_id,'purchase','purchase_invoice',purchase_order_id,'accounting','journal_entry',journal_entry_id,'settled_by' from public.purchase_payment_allocations where company_id is not null and business_unit_id is not null on conflict do nothing;
insert into public.transaction_links(company_id,business_unit_id,source_module,source_type,source_id,target_module,target_type,target_id,relation_type)
select company_id,business_unit_id,'sales','sales_invoice',sales_order_id,'production','gate_pass',id,'dispatched_by' from public.gate_passes where sales_order_id is not null and company_id is not null and business_unit_id is not null on conflict do nothing;
insert into public.transaction_links(company_id,business_unit_id,source_module,source_type,source_id,target_module,target_type,target_id,relation_type)
select company_id,business_unit_id,'sales','order_book',order_book_header_id,'production','gate_pass',id,'dispatched_by' from public.gate_passes where order_book_header_id is not null and company_id is not null and business_unit_id is not null on conflict do nothing;
insert into public.transaction_links(company_id,business_unit_id,source_module,source_type,source_id,target_module,target_type,target_id,relation_type)
select company_id,business_unit_id,case when lower(document_type) like '%purchase%' then 'purchase' else 'sales' end,'order_book_commitment',commitment_id,
       case when lower(document_type) like '%purchase%' then 'purchase' else 'sales' end,document_type,document_id,'fulfilled_by'
from public.order_book_fulfillments where company_id is not null and business_unit_id is not null on conflict do nothing;
insert into public.transaction_links(company_id,business_unit_id,source_module,source_type,source_id,target_module,target_type,target_id,relation_type)
select company_id,business_unit_id,'sales','order_book_commitment',order_book_commitment_id,'sales','sales_invoice',order_id,'fulfilled_by' from public.sales_order_lines where order_book_commitment_id is not null and company_id is not null and business_unit_id is not null on conflict do nothing;
insert into public.transaction_links(company_id,business_unit_id,source_module,source_type,source_id,target_module,target_type,target_id,relation_type)
select company_id,business_unit_id,'purchase','order_book_commitment',order_book_commitment_id,'purchase','purchase_invoice',order_id,'fulfilled_by' from public.purchase_order_lines where order_book_commitment_id is not null and company_id is not null and business_unit_id is not null on conflict do nothing;

create or replace view public.commercial_document_nodes
with (security_invoker=true)
as
select company_id,business_unit_id,'sales'::text module_key,'sales_invoice'::text document_type,id document_id,order_no document_no,order_date document_date,status from public.sales_orders
union all select company_id,business_unit_id,'purchase','purchase_invoice',id,order_no,order_date,status from public.purchase_orders
union all select company_id,business_unit_id,'accounting','journal_entry',id,entry_no,entry_date,status from public.journal_entries
union all select company_id,business_unit_id,'accounting','return_note',id,note_no,note_date,status from public.return_notes
union all select company_id,business_unit_id,'production','gate_pass',id,pass_no,pass_date,status from public.gate_passes
union all select company_id,business_unit_id,case when order_type='purchase' then 'purchase' else 'sales' end,'order_book',id,order_no,order_date,status from public.order_book_headers
union all select company_id,business_unit_id,'inventory','stock_movement',id,coalesce(reference,id::text),created_at::date,type from public.stock_movements
union all select company_id,business_unit_id,'sales','consolidated_sales_invoice',id,invoice_no,invoice_date,status from public.consolidated_sales_invoices
union all select company_id,business_unit_id,'purchase','consolidated_purchase_invoice',id,invoice_no,invoice_date,status from public.consolidated_purchase_invoices;

revoke all on public.commercial_document_nodes from anon;
grant select on public.commercial_document_nodes to authenticated;

notify pgrst,'reload schema';
commit;
