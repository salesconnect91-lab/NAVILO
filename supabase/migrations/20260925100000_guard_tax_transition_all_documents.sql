-- Apply company tax history at the document date across both sales and purchase.
-- This trigger never recalculates an existing document or its ledger entries.
create function public.guard_document_tax_transition()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_date date;
  v_mode text;
begin
  if tg_op='UPDATE' and old.status='posted' and
     (new.company_id is distinct from old.company_id or
      new.invoice_type is distinct from old.invoice_type or
      new.tax_percent is distinct from old.tax_percent or
      (case when tg_table_name in ('sales_orders','purchase_orders') then
         to_jsonb(new)->>'order_date' else to_jsonb(new)->>'invoice_date' end)
      is distinct from
      (case when tg_table_name in ('sales_orders','purchase_orders') then
         to_jsonb(old)->>'order_date' else to_jsonb(old)->>'invoice_date' end)) then
    raise exception 'Posted document tax treatment and date cannot be changed';
  end if;

  v_date:=case when tg_table_name in ('sales_orders','purchase_orders')
    then (to_jsonb(new)->>'order_date')::date else (to_jsonb(new)->>'invoice_date')::date end;
  if new.invoice_type='Tax Invoice' then
    select e.tax_mode into v_mode from public.company_tax_events e
    where e.company_id=new.company_id and e.effective_from<=v_date
    order by e.effective_from desc limit 1;
    if v_mode='non_tax' then
      raise exception 'Tax invoices are unavailable while this company is Non-Tax registered on %',v_date;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_document_tax_transition() from public,anon,authenticated;

drop trigger if exists enforce_non_tax_sales_order on public.sales_orders;
drop trigger if exists enforce_non_tax_consolidated_sales on public.consolidated_sales_invoices;
drop function if exists public.enforce_non_tax_sales_invoice();

create trigger guard_sales_tax_transition before insert or update of company_id,invoice_type,order_date,tax_percent,status
on public.sales_orders for each row execute function public.guard_document_tax_transition();
create trigger guard_purchase_tax_transition before insert or update of company_id,invoice_type,order_date,tax_percent,status
on public.purchase_orders for each row execute function public.guard_document_tax_transition();
create trigger guard_consolidated_sales_tax_transition before insert or update of company_id,invoice_type,invoice_date,tax_percent,status
on public.consolidated_sales_invoices for each row execute function public.guard_document_tax_transition();
create trigger guard_consolidated_purchase_tax_transition before insert or update of company_id,invoice_type,invoice_date,tax_percent,status
on public.consolidated_purchase_invoices for each row execute function public.guard_document_tax_transition();
