-- Keep legacy companies unchanged until an explicit tax event exists.
-- Apply the selected mode to newly created or edited sales documents only;
-- historical posted rows are never rewritten.
create function public.enforce_non_tax_sales_invoice()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_document_date date;
declare v_mode text;
begin
  if tg_table_name='sales_orders' then
    v_document_date:=new.order_date;
  else
    v_document_date:=new.invoice_date;
  end if;
  if new.invoice_type='Tax Invoice' then
    select e.tax_mode into v_mode
      from public.company_tax_events e
     where e.company_id=new.company_id and e.effective_from<=v_document_date
     order by e.effective_from desc limit 1;
    if v_mode='non_tax' then
      raise exception 'Tax invoices are unavailable while this company is Non-Tax registered on %',v_document_date;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.enforce_non_tax_sales_invoice() from public,anon,authenticated;

create trigger enforce_non_tax_sales_order
before insert or update of invoice_type,order_date,status on public.sales_orders
for each row execute function public.enforce_non_tax_sales_invoice();

create trigger enforce_non_tax_consolidated_sales
before insert or update of invoice_type,invoice_date,status on public.consolidated_sales_invoices
for each row execute function public.enforce_non_tax_sales_invoice();
