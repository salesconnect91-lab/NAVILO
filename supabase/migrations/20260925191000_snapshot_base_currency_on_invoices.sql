-- Existing sales/purchase posting, inventory and payment RPCs use company
-- base amounts. Snapshot that contract on new documents and refuse explicit
-- foreign amounts until all three paths can convert them together.
-- Historical documents remain untouched (including their null snapshots).
alter table public.sales_orders add column currency_code text references public.currency_master(code),
  add column exchange_rate numeric(24,10);
alter table public.purchase_orders add column currency_code text references public.currency_master(code),
  add column exchange_rate numeric(24,10);
alter table public.consolidated_sales_invoices add column currency_code text references public.currency_master(code),
  add column exchange_rate numeric(24,10);
alter table public.consolidated_purchase_invoices add column currency_code text references public.currency_master(code),
  add column exchange_rate numeric(24,10);

create function public.guard_document_base_currency_snapshot()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_base text;
begin
  if tg_op='UPDATE' and old.status='posted' then
    if new.currency_code is distinct from old.currency_code or
       new.exchange_rate is distinct from old.exchange_rate then
      raise exception 'Posted invoice currency snapshot is immutable';
    end if;
    return new;
  end if;

  select base_currency_code into v_base from public.companies where id=new.company_id;
  if v_base is null then raise exception 'Invoice company has no base currency'; end if;
  if new.currency_code is not null and new.currency_code<>v_base then
    raise exception 'Foreign sales/purchase invoice posting requires base-currency inventory, payment and ledger conversion';
  end if;
  if new.exchange_rate is not null and new.exchange_rate<>1::numeric then
    raise exception 'Base-currency invoice exchange rate must equal one';
  end if;
  new.currency_code:=v_base;
  new.exchange_rate:=1;
  return new;
end $$;
revoke all on function public.guard_document_base_currency_snapshot() from public,anon,authenticated;

create trigger zz_guard_invoice_base_currency before insert or update of
  company_id,currency_code,exchange_rate,status on public.sales_orders
for each row execute function public.guard_document_base_currency_snapshot();
create trigger zz_guard_invoice_base_currency before insert or update of
  company_id,currency_code,exchange_rate,status on public.purchase_orders
for each row execute function public.guard_document_base_currency_snapshot();
create trigger zz_guard_invoice_base_currency before insert or update of
  company_id,currency_code,exchange_rate,status on public.consolidated_sales_invoices
for each row execute function public.guard_document_base_currency_snapshot();
create trigger zz_guard_invoice_base_currency before insert or update of
  company_id,currency_code,exchange_rate,status on public.consolidated_purchase_invoices
for each row execute function public.guard_document_base_currency_snapshot();
