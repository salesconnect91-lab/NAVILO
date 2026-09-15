create or replace function public.assign_consolidated_sales_invoice_number()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_year text;
  v_prefix text;
  v_next bigint;
begin
  if new.invoice_date is null then new.invoice_date := current_date; end if;
  v_year := extract(year from new.invoice_date)::int::text;
  v_prefix := 'CI-' || v_year || '-';

  if new.invoice_no is null
     or btrim(new.invoice_no) = ''
     or new.invoice_no ~ '^CI-[0-9]{8}-[0-9]{6}$' then
    perform pg_advisory_xact_lock(hashtext(coalesce(new.company_id::text,'') || ':consolidated-sales:' || v_year));
    select coalesce(max((substring(invoice_no from '^CI-[0-9]{4}-([0-9]+)$'))::bigint),0) + 1
      into v_next
      from public.consolidated_sales_invoices
     where company_id is not distinct from new.company_id
       and invoice_no ~ ('^CI-' || v_year || '-[0-9]+$');
    new.invoice_no := v_prefix || lpad(v_next::text,4,'0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assign_consolidated_sales_invoice_number on public.consolidated_sales_invoices;
create trigger trg_assign_consolidated_sales_invoice_number
before insert on public.consolidated_sales_invoices
for each row execute function public.assign_consolidated_sales_invoice_number();

create unique index if not exists uq_consolidated_sales_invoice_company_no
on public.consolidated_sales_invoices(company_id, invoice_no);
