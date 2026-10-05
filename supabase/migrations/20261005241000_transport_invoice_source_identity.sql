-- Durable external identity for Transport Sales invoice imports.
-- No historical backfill: existing invoices remain unchanged.
alter table public.sales_orders add column if not exists transport_source_company text;
alter table public.sales_orders add column if not exists transport_source_invoice_id text;

create unique index if not exists sales_orders_transport_source_invoice_uidx
on public.sales_orders(company_id,business_unit_id,lower(btrim(transport_source_company)),lower(btrim(transport_source_invoice_id)))
where transport_source_invoice_id is not null and btrim(transport_source_invoice_id)<>'' and transport_source_company is not null and btrim(transport_source_company)<>'';

comment on column public.sales_orders.transport_source_company is 'External/source company key for idempotent Transport invoice imports.';
comment on column public.sales_orders.transport_source_invoice_id is 'Stable external invoice identifier for idempotent Transport invoice imports; independent of editable invoice number.';
