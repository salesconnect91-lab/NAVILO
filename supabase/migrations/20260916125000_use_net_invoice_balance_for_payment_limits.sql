-- Payment allocations must never exceed the invoice balance after posted
-- credit/debit notes.  The header recalculation triggers already use this net
-- balance; enforce the same rule at the allocation write boundary so every
-- current and future RPC is protected.

create or replace function public.validate_invoice_payment_allocation()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_invoice_customer_id uuid;
  v_invoice_total numeric := 0;
  v_invoice_unit uuid;
  v_invoice_location uuid;
  v_invoice_status text;
  v_returns numeric := 0;
  v_net_total numeric := 0;
  v_existing_allocated numeric := 0;
begin
  if new.amount is null or new.amount <= 0 then
    raise exception 'Allocation amount must be greater than zero.';
  end if;

  select customer_id, coalesce(total, 0), business_unit_id,
         operating_location_id, status
    into v_invoice_customer_id, v_invoice_total, v_invoice_unit,
         v_invoice_location, v_invoice_status
  from public.sales_orders
  where id = new.sales_order_id
    and company_id = new.company_id;

  if v_invoice_customer_id is null then
    raise exception 'Invoice does not have a customer assigned.';
  end if;
  if v_invoice_status <> 'posted' then
    raise exception 'Only posted Sales Invoices can receive payment allocations.';
  end if;
  if new.customer_id is distinct from v_invoice_customer_id then
    raise exception 'Selected payment customer does not match invoice customer.';
  end if;
  if new.business_unit_id is not null
     and new.business_unit_id is distinct from v_invoice_unit then
    raise exception 'Payment allocation belongs to another business unit.';
  end if;
  if new.operating_location_id is not null
     and v_invoice_location is not null
     and new.operating_location_id is distinct from v_invoice_location then
    raise exception 'Payment allocation belongs to another operating location.';
  end if;

  new.business_unit_id := v_invoice_unit;
  if v_invoice_location is not null then
    new.operating_location_id := v_invoice_location;
  end if;

  select round(coalesce(sum(total), 0), 2)
    into v_returns
  from public.return_notes
  where sales_order_id = new.sales_order_id
    and company_id = new.company_id
    and business_unit_id = v_invoice_unit
    and note_type = 'sales_credit'
    and status = 'posted';

  select round(coalesce(sum(amount), 0), 2)
    into v_existing_allocated
  from public.invoice_payment_allocations
  where sales_order_id = new.sales_order_id
    and company_id = new.company_id
    and business_unit_id = v_invoice_unit
    and id <> coalesce(new.id, gen_random_uuid());

  v_net_total := greatest(round(v_invoice_total - v_returns, 2), 0);
  if round(v_existing_allocated + new.amount, 2) > v_net_total + 0.005 then
    raise exception
      'Allocation exceeds Sales Invoice net outstanding after credit notes. Net invoice: %, Already allocated: %, New allocation: %',
      v_net_total, v_existing_allocated, new.amount;
  end if;

  return new;
end;
$function$;

create or replace function public.validate_purchase_payment_allocation()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_supplier uuid;
  v_total numeric := 0;
  v_unit uuid;
  v_location uuid;
  v_status text;
  v_returns numeric := 0;
  v_net_total numeric := 0;
  v_existing numeric := 0;
begin
  if new.amount is null or new.amount <= 0 then
    raise exception 'Allocation amount must be greater than zero.';
  end if;

  select supplier_id, coalesce(total, 0), business_unit_id,
         operating_location_id, status
    into v_supplier, v_total, v_unit, v_location, v_status
  from public.purchase_orders
  where id = new.purchase_order_id
    and company_id = new.company_id;

  if v_supplier is null then
    raise exception 'Purchase invoice does not have a supplier assigned.';
  end if;
  if v_status <> 'posted' then
    raise exception 'Only posted Purchase Invoices can receive payment allocations.';
  end if;
  if new.supplier_id is distinct from v_supplier then
    raise exception 'Selected payment supplier does not match Purchase Invoice supplier.';
  end if;
  if new.business_unit_id is not null
     and new.business_unit_id is distinct from v_unit then
    raise exception 'Payment allocation belongs to another business unit.';
  end if;
  if new.operating_location_id is not null
     and v_location is not null
     and new.operating_location_id is distinct from v_location then
    raise exception 'Payment allocation belongs to another operating location.';
  end if;

  new.business_unit_id := v_unit;
  if v_location is not null then
    new.operating_location_id := v_location;
  end if;

  select round(coalesce(sum(total), 0), 2)
    into v_returns
  from public.return_notes
  where purchase_order_id = new.purchase_order_id
    and company_id = new.company_id
    and business_unit_id = v_unit
    and note_type = 'purchase_debit'
    and status = 'posted';

  select round(coalesce(sum(amount), 0), 2)
    into v_existing
  from public.purchase_payment_allocations
  where purchase_order_id = new.purchase_order_id
    and company_id = new.company_id
    and business_unit_id = v_unit
    and id <> coalesce(new.id, gen_random_uuid());

  v_net_total := greatest(round(v_total - v_returns, 2), 0);
  if round(v_existing + new.amount, 2) > v_net_total + 0.005 then
    raise exception
      'Allocation exceeds Purchase Invoice net outstanding after debit notes. Net invoice: %, Already allocated: %, New allocation: %',
      v_net_total, v_existing, new.amount;
  end if;

  return new;
end;
$function$;

revoke all on function public.validate_invoice_payment_allocation()
  from public, anon, authenticated;
revoke all on function public.validate_purchase_payment_allocation()
  from public, anon, authenticated;
