begin;

-- These trigger functions are intentionally shared by tables with different
-- row shapes.  Never reference a table-specific NEW field in a SQL CASE or a
-- compound boolean that PostgreSQL may prepare before the table discriminator
-- has isolated the matching row type.

create or replace function public.apply_document_discount_total()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_own numeric := 0;
  v_linked numeric := 0;
  v_type text := TG_ARGV[0];
  v_no text;
  v_row jsonb := to_jsonb(NEW);
begin
  if TG_TABLE_NAME in ('sales_orders', 'purchase_orders') then
    v_no := coalesce(v_row ->> 'order_no', '');
  else
    v_no := coalesce(v_row ->> 'invoice_no', '');
  end if;

  select coalesce((
    select d.discount_amount
    from public.commercial_invoice_discounts d
    where d.company_id = NEW.company_id
      and d.business_unit_id = NEW.business_unit_id
      and d.document_type = v_type
      and d.document_no = v_no
    limit 1
  ), 0)
  into v_own;

  if NEW.status = 'posted' and TG_TABLE_NAME = 'sales_orders' then
    select coalesce(sum(d.discount_amount), 0)
    into v_linked
    from public.sales_order_hawala_invoices l
    join public.consolidated_sales_invoices h on h.id = l.hawala_invoice_id
    join public.commercial_invoice_discounts d
      on d.company_id = NEW.company_id
     and d.business_unit_id = NEW.business_unit_id
     and d.document_type = 'sales_consolidated'
     and d.document_no = h.invoice_no
    where l.sales_order_id = NEW.id
      and l.company_id = NEW.company_id
      and l.business_unit_id = NEW.business_unit_id;
  elsif NEW.status = 'posted' and TG_TABLE_NAME = 'purchase_orders' then
    select coalesce(sum(d.discount_amount), 0)
    into v_linked
    from public.purchase_order_consolidated_invoices l
    join public.consolidated_purchase_invoices h on h.id = l.consolidated_invoice_id
    join public.commercial_invoice_discounts d
      on d.company_id = NEW.company_id
     and d.business_unit_id = NEW.business_unit_id
     and d.document_type = 'purchase_consolidated'
     and d.document_no = h.invoice_no
    where l.purchase_order_id = NEW.id
      and l.company_id = NEW.company_id
      and l.business_unit_id = NEW.business_unit_id;
  end if;

  NEW.total := greatest(round(coalesce(NEW.total, 0) - coalesce(v_own, 0) - coalesce(v_linked, 0), 2), 0);
  return NEW;
end;
$$;

create or replace function public.navilo_link_posting_traceability()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
begin
  if TG_TABLE_NAME = 'journal_entries' then
    if NEW.source_document_id is null then
      if lower(coalesce(NEW.trans_type, '')) in ('sales invoice', 'sales') then
        select so.id into NEW.source_document_id
        from public.sales_orders so
        where so.company_id = NEW.company_id and so.order_no = NEW.entry_no
        order by so.created_at desc limit 1;
        if NEW.source_document_id is not null then
          NEW.source_module := coalesce(NEW.source_module, 'sales');
          NEW.source_document_type := coalesce(NEW.source_document_type, 'sales_invoice');
        end if;
      elsif lower(coalesce(NEW.trans_type, '')) in ('purchase invoice', 'purchase') then
        select po.id into NEW.source_document_id
        from public.purchase_orders po
        where po.company_id = NEW.company_id
          and ('PUR-' || po.order_no = NEW.entry_no or po.order_no = NEW.entry_no)
        order by po.created_at desc limit 1;
        if NEW.source_document_id is not null then
          NEW.source_module := coalesce(NEW.source_module, 'purchase');
          NEW.source_document_type := coalesce(NEW.source_document_type, 'purchase_invoice');
        end if;
      end if;
    end if;
  elsif TG_TABLE_NAME = 'stock_movements' then
    if NEW.source_id is null and nullif(btrim(coalesce(NEW.reference, '')), '') is not null then
      if lower(coalesce(NEW.type, '')) = 'out' then
        select so.id into NEW.source_id
        from public.sales_orders so
        where so.company_id = NEW.company_id and so.order_no = NEW.reference
        order by so.created_at desc limit 1;
        if NEW.source_id is not null then NEW.source_type := 'sales_invoice'; end if;
      elsif lower(coalesce(NEW.type, '')) = 'in' then
        select po.id into NEW.source_id
        from public.purchase_orders po
        where po.company_id = NEW.company_id and po.order_no = NEW.reference
        order by po.created_at desc limit 1;
        if NEW.source_id is not null then NEW.source_type := 'purchase_invoice'; end if;
      end if;
    end if;
  end if;
  return NEW;
end;
$$;

create or replace function public.sync_commercial_transaction_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_module text;
begin
  if TG_TABLE_NAME = 'journal_entries' then
    if NEW.source_document_id is not null then
      v_module := case when NEW.source_module in ('sales','purchase','inventory','production','transport','accounting') then NEW.source_module else 'accounting' end;
      perform public.record_transaction_link(NEW.company_id,NEW.business_unit_id,v_module,coalesce(NEW.source_document_type,'source_document'),NEW.source_document_id,'accounting','journal_entry',NEW.id,'posted_as');
    end if;
  elsif TG_TABLE_NAME = 'return_notes' then
    if NEW.sales_order_id is not null then perform public.record_transaction_link(NEW.company_id,NEW.business_unit_id,'sales','sales_invoice',NEW.sales_order_id,'accounting','return_note',NEW.id,'returned_by'); end if;
    if NEW.purchase_order_id is not null then perform public.record_transaction_link(NEW.company_id,NEW.business_unit_id,'purchase','purchase_invoice',NEW.purchase_order_id,'accounting','return_note',NEW.id,'returned_by'); end if;
    if NEW.journal_entry_id is not null then perform public.record_transaction_link(NEW.company_id,NEW.business_unit_id,'accounting','return_note',NEW.id,'accounting','journal_entry',NEW.journal_entry_id,'posted_as'); end if;
  elsif TG_TABLE_NAME = 'invoice_payment_allocations' then
    perform public.record_transaction_link(NEW.company_id,NEW.business_unit_id,'sales','sales_invoice',NEW.sales_order_id,'accounting','journal_entry',NEW.journal_entry_id,'settled_by');
  elsif TG_TABLE_NAME = 'purchase_payment_allocations' then
    perform public.record_transaction_link(NEW.company_id,NEW.business_unit_id,'purchase','purchase_invoice',NEW.purchase_order_id,'accounting','journal_entry',NEW.journal_entry_id,'settled_by');
  elsif TG_TABLE_NAME = 'stock_movements' then
    if NEW.source_id is not null then
      v_module := case
        when lower(coalesce(NEW.source_type,'')) like '%sales%' then 'sales'
        when lower(coalesce(NEW.source_type,'')) like '%purchase%' then 'purchase'
        when lower(coalesce(NEW.source_type,'')) like '%work%' or lower(coalesce(NEW.source_type,'')) like '%production%' then 'production'
        else 'inventory' end;
      perform public.record_transaction_link(NEW.company_id,NEW.business_unit_id,v_module,coalesce(NEW.source_type,'source_document'),NEW.source_id,'inventory','stock_movement',NEW.id,'moved_stock');
    end if;
  elsif TG_TABLE_NAME = 'gate_passes' then
    if NEW.sales_order_id is not null then perform public.record_transaction_link(NEW.company_id,NEW.business_unit_id,'sales','sales_invoice',NEW.sales_order_id,'production','gate_pass',NEW.id,'dispatched_by'); end if;
    if NEW.order_book_header_id is not null then perform public.record_transaction_link(NEW.company_id,NEW.business_unit_id,'sales','order_book',NEW.order_book_header_id,'production','gate_pass',NEW.id,'dispatched_by'); end if;
  elsif TG_TABLE_NAME = 'order_book_fulfillments' then
    v_module := case when lower(coalesce(NEW.document_type,'')) like '%purchase%' then 'purchase' else 'sales' end;
    perform public.record_transaction_link(NEW.company_id,NEW.business_unit_id,v_module,'order_book_commitment',NEW.commitment_id,v_module,NEW.document_type,NEW.document_id,'fulfilled_by');
  elsif TG_TABLE_NAME = 'sales_order_lines' then
    if NEW.order_book_commitment_id is not null then
      perform public.record_transaction_link(NEW.company_id,NEW.business_unit_id,'sales','order_book_commitment',NEW.order_book_commitment_id,'sales','sales_invoice',NEW.order_id,'fulfilled_by');
    end if;
  elsif TG_TABLE_NAME = 'purchase_order_lines' then
    if NEW.order_book_commitment_id is not null then
      perform public.record_transaction_link(NEW.company_id,NEW.business_unit_id,'purchase','order_book_commitment',NEW.order_book_commitment_id,'purchase','purchase_invoice',NEW.order_id,'fulfilled_by');
    end if;
  end if;
  return NEW;
end;
$$;

revoke all on function public.apply_document_discount_total() from public, anon, authenticated;
revoke all on function public.navilo_link_posting_traceability() from public, anon, authenticated;
revoke all on function public.sync_commercial_transaction_link() from public, anon, authenticated;

commit;
