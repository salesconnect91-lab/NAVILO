-- Read-only Transport Trip correction preflight.
-- This endpoint never changes trips, invoices, journals, VAT, or balances.
create or replace function public.transport_admin_trip_correction_preflight(p_trip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip record;
  v_customer_docs jsonb;
  v_supplier_docs jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not public.company_admin_posted_journal_edit_access() then
    raise exception 'Owner or active company/business-unit Admin required';
  end if;
  perform public.assert_module_permission('transport','edit');

  select t.id, t.trip_no, t.trip_date, t.status, t.customer_id, t.vehicle_id,
         t.driver_id, t.company_id, t.business_unit_id
    into v_trip
    from public.transport_trips t
   where t.id = p_trip_id
     and t.company_id = public.current_company_id()
     and t.business_unit_id = public.current_business_unit_id()
   for share;
  if not found then
    raise exception 'Trip not found in active workspace';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'document_id', d.id, 'order_id', o.id, 'invoice_no', o.order_no,
    'status', o.status, 'journal_entry_id', d.journal_entry_id,
    'paid_amount', coalesce(o.paid_amount,0),
    'outstanding_amount', coalesce(o.outstanding_amount,0),
    'payment_allocations', (select count(*) from public.invoice_payment_allocations a where a.sales_order_id=o.id),
    'service_notes', (select count(*) from public.transport_service_note_lines n where n.order_id=o.id and n.side='customer')
  )), '[]'::jsonb)
    into v_customer_docs
    from public.transport_customer_document_trips l
    join public.transport_customer_documents d on d.id=l.document_id
    left join public.sales_orders o on o.id=d.sales_order_id
   where l.trip_id=v_trip.id and not l.is_adjustment
     and d.company_id=v_trip.company_id and d.business_unit_id=v_trip.business_unit_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'document_id', d.id, 'order_id', o.id, 'invoice_no', o.order_no,
    'status', o.status, 'journal_entry_id', d.journal_entry_id,
    'rent_lines', (select count(*) from public.transport_supplier_document_rents x where x.document_id=d.id and not x.is_adjustment)
  )), '[]'::jsonb)
    into v_supplier_docs
    from public.transport_supplier_document_rents l
    join public.transport_supplier_documents d on d.id=l.document_id
    left join public.purchase_orders o on o.id=d.purchase_order_id
   where l.trip_id=v_trip.id and not l.is_adjustment
     and d.company_id=v_trip.company_id and d.business_unit_id=v_trip.business_unit_id;

  return jsonb_build_object(
    'trip_id', v_trip.id, 'trip_no', v_trip.trip_no, 'trip_date', v_trip.trip_date,
    'status', v_trip.status, 'customer_id', v_trip.customer_id,
    'vehicle_id', v_trip.vehicle_id, 'driver_id', v_trip.driver_id,
    'customer_side_posted', public.transport_customer_side_posted(v_trip.id),
    'supplier_side_posted', public.transport_supplier_side_posted(v_trip.id),
    'customer_documents', v_customer_docs, 'supplier_documents', v_supplier_docs,
    'result', 'READ_ONLY_PREFLIGHT_NO_CHANGES_APPLIED'
  );
end;
$$;
revoke all on function public.transport_admin_trip_correction_preflight(uuid) from public, anon;
grant execute on function public.transport_admin_trip_correction_preflight(uuid) to authenticated;
