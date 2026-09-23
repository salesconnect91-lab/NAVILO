create or replace function public.enforce_active_operating_location_write_scope()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_location uuid;
begin
  if coalesce(current_setting('app.maintenance_reset',true),'0')='1' or auth.role()='service_role' then
    return case when tg_op='DELETE' then old else new end;
  end if;
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  v_location:=public.current_operating_location_id();
  if v_location is null then raise exception 'Select an active branch/location before changing branch-scoped data.'; end if;
  if tg_op='DELETE' then
    if old.operating_location_id is distinct from v_location then raise exception 'Cross-branch delete denied.'; end if;
    return old;
  end if;
  if new.operating_location_id is null then new.operating_location_id:=v_location; end if;
  if new.operating_location_id is distinct from v_location then raise exception 'Cross-branch write denied.'; end if;
  if tg_op='UPDATE' and old.operating_location_id is distinct from v_location then raise exception 'Cross-branch update denied.'; end if;
  return new;
end $$;
revoke all on function public.enforce_active_operating_location_write_scope() from public,anon,authenticated;
grant execute on function public.enforce_active_operating_location_write_scope() to service_role;

do $$ declare t text; begin
foreach t in array array[
'consolidated_purchase_invoice_charges','consolidated_purchase_invoice_lines','consolidated_purchase_invoices',
'consolidated_sales_invoice_charges','consolidated_sales_invoice_lines','consolidated_sales_invoices',
'cutting_orders','fixed_assets','gate_pass_lines','gate_passes','invoice_payment_allocations',
'order_book_commitments','order_book_headers','party_ledgers','purchase_order_consolidated_invoices',
'purchase_order_lines','purchase_orders','purchase_payment_allocations','return_note_lines','return_notes',
'sales_consolidation_invoices','sales_consolidations','sales_order_hawala_invoices','sales_order_lines','sales_orders',
'stock_movements','warehouse_stock','work_orders'] loop
 execute format('drop trigger if exists zzzz_operating_location_write_scope on public.%I',t);
 execute format('create trigger zzzz_operating_location_write_scope before insert or update or delete on public.%I for each row execute function public.enforce_active_operating_location_write_scope()',t);
end loop; end $$;
