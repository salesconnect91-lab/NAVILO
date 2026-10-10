-- Read-only owner review for posted Sales/Purchase/Transport service invoices.
-- No posted document, GL, VAT, inventory or transport evidence is altered.
-- Deliberately do not expose an unsafe generic invoice-cancellation RPC.
create or replace function public.owner_posted_invoice_cancellation_review(
  p_document_type text, p_document_id uuid
) returns jsonb
language plpgsql stable security definer
set search_path to 'public','pg_temp'
as $$
declare
  c uuid:=public.current_company_id();
  b uuid:=public.current_business_unit_id();
  v_kind text:=lower(btrim(coalesce(p_document_type,'')));
  v_no text;
  v_status text;
  v_invoice_type text;
  v_document_kind text;
  v_paid numeric;
  v_journals integer:=0;
  v_stock integer:=0;
  v_allocations integer:=0;
  v_transport integer:=0;
  v_reasons text[]:=array[]::text[];
begin
  if not public.owner_posted_control_access() then
    raise exception 'NAVILO software owner access required.';
  end if;
  if c is null or b is null or p_document_id is null then
    raise exception 'Active company, business unit and document are required.';
  end if;
  if v_kind='sales' then
    select order_no,status,invoice_type,document_kind,coalesce(paid_amount,0)
      into v_no,v_status,v_invoice_type,v_document_kind,v_paid
    from public.sales_orders where id=p_document_id and company_id=c and business_unit_id=b;
    if not found then raise exception 'Sales invoice not found in active business unit.'; end if;
    select count(*) into v_stock from public.stock_movements
      where company_id=c and business_unit_id=b and source_id=p_document_id
        and source_type='sales_invoice';
    select count(*) into v_allocations from public.invoice_payment_allocations
      where company_id=c and business_unit_id=b and sales_order_id=p_document_id;
    select count(*) into v_transport from public.transport_customer_documents
      where company_id=c and business_unit_id=b and sales_order_id=p_document_id;
  elsif v_kind='purchase' then
    select order_no,status,invoice_type,document_kind,coalesce(paid_amount,0)
      into v_no,v_status,v_invoice_type,v_document_kind,v_paid
    from public.purchase_orders where id=p_document_id and company_id=c and business_unit_id=b;
    if not found then raise exception 'Purchase invoice not found in active business unit.'; end if;
    select count(*) into v_stock from public.stock_movements
      where company_id=c and business_unit_id=b and source_id=p_document_id
        and source_type='purchase_invoice';
    select count(*) into v_allocations from public.purchase_payment_allocations
      where company_id=c and business_unit_id=b and purchase_order_id=p_document_id;
    select count(*) into v_transport from public.transport_supplier_documents
      where company_id=c and business_unit_id=b and purchase_order_id=p_document_id;
  else
    raise exception 'Document type must be sales or purchase.';
  end if;
  select count(*) into v_journals from public.journal_entries
    where company_id=c and business_unit_id=b and source_document_id=p_document_id
      and source_document_type=case when v_kind='sales' then 'sales_invoice' else 'purchase_invoice' end
      and status='posted';
  if v_status<>'posted' then
    v_reasons:=array_append(v_reasons,'Document is not a posted invoice.');
  end if;
  if v_paid<>0 or v_allocations>0 then
    v_reasons:=array_append(v_reasons,'Payment/receipt evidence exists; allocations and refunds need a controlled workflow.');
  end if;
  if v_stock>0 then
    v_reasons:=array_append(v_reasons,'Inventory movements exist; a stock-aware credit/debit note or return is required.');
  end if;
  if v_transport>0 or v_document_kind='service' then
    v_reasons:=array_append(v_reasons,'Transport service invoice: trip charges, VAT, allocations and ledgers must be corrected through Trip Finance.');
  end if;
  if v_invoice_type='Tax Invoice' then
    v_reasons:=array_append(v_reasons,'Tax Invoice: preserve original tax evidence and issue dated credit/debit note as applicable.');
  end if;
  if v_journals<>1 then
    v_reasons:=array_append(v_reasons,'Exactly one linked posted source journal is required for a safe reversal.');
  end if;
  v_reasons:=array_append(v_reasons,'Direct posted invoice cancellation is not enabled: no verified atomic VAT/stock/transport reversal workflow exists yet.');
  return jsonb_build_object(
    'document_type',v_kind,'document_id',p_document_id,'document_no',v_no,
    'status',v_status,'document_kind',v_document_kind,'invoice_type',v_invoice_type,
    'paid_amount',v_paid,'linked_journals',v_journals,
    'stock_movements',v_stock,'payment_allocations',v_allocations,
    'transport_documents',v_transport,'can_cancel',false,
    'reasons',to_jsonb(v_reasons),'history_preserved',true
  );
end;
$$;
revoke all on function public.owner_posted_invoice_cancellation_review(text,uuid) from public,anon;
grant execute on function public.owner_posted_invoice_cancellation_review(text,uuid) to authenticated;
