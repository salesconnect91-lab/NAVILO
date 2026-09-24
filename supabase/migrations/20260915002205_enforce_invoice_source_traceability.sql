create or replace function public.attach_invoice_source_traceability()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_sales_id uuid;
  v_purchase_id uuid;
begin
  if new.company_id is null then return new; end if;

  if new.trans_type='Sales Invoice' then
    select id into v_sales_id from public.sales_orders
    where company_id=new.company_id and order_no=new.entry_no limit 1;
    if v_sales_id is not null then
      new.source_module:='sales';
      new.source_document_type:='sales_invoice';
      new.source_document_id:=v_sales_id;
    end if;
  elsif new.trans_type='Purchase' then
    select id into v_purchase_id from public.purchase_orders
    where company_id=new.company_id and ('PUR-'||order_no)=new.entry_no limit 1;
    if v_purchase_id is not null then
      new.source_module:='purchase';
      new.source_document_type:='purchase_invoice';
      new.source_document_id:=v_purchase_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_attach_invoice_source_traceability on public.journal_entries;
create trigger trg_attach_invoice_source_traceability
before insert on public.journal_entries
for each row execute function public.attach_invoice_source_traceability();

create or replace function public.attach_stock_source_traceability()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if new.source_id is not null or new.company_id is null or nullif(btrim(coalesce(new.reference,'')),'') is null then return new; end if;

  if new.type='out' then
    select id into new.source_id from public.sales_orders
    where company_id=new.company_id and order_no=new.reference and status in ('draft','posted') limit 1;
    if new.source_id is not null then new.source_type:='sales_invoice'; end if;
  elsif new.type='in' then
    select id into new.source_id from public.purchase_orders
    where company_id=new.company_id and order_no=new.reference and status in ('draft','posted') limit 1;
    if new.source_id is not null then new.source_type:='purchase_invoice'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_attach_stock_source_traceability on public.stock_movements;
create trigger trg_attach_stock_source_traceability
before insert on public.stock_movements
for each row execute function public.attach_stock_source_traceability();

comment on function public.attach_invoice_source_traceability() is 'Automatically attaches direct Sales/Purchase source document IDs to newly created invoice journals.';
comment on function public.attach_stock_source_traceability() is 'Automatically attaches direct Sales/Purchase source IDs to newly created invoice stock movements.';

