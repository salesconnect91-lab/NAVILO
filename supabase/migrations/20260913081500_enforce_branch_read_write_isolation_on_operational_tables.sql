-- Match operational data visibility to the existing journal/GL branch scope rule.
-- A selected branch sees only its rows; a no-branch context sees only legacy/global null-location rows.
do $block$
declare t text;
begin
  foreach t in array array[
    'sales_orders','purchase_orders','stock_movements','warehouse_stock','work_orders','cutting_orders','gate_passes',
    'party_ledgers','invoice_payment_allocations','purchase_payment_allocations','fixed_assets','order_book_headers','order_book_commitments'
  ] loop
    execute format('drop policy if exists branch_operating_location_scope on public.%I',t);
    execute format($sql$
      create policy branch_operating_location_scope on public.%I
      as restrictive for all to authenticated
      using (((public.current_operating_location_id() is null) and (operating_location_id is null)) or operating_location_id=public.current_operating_location_id())
      with check (((public.current_operating_location_id() is null) and (operating_location_id is null)) or operating_location_id=public.current_operating_location_id())
    $sql$,t);
  end loop;
end
$block$;
