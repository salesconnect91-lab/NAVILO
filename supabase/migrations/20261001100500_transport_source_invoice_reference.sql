-- Preserve source/legacy invoice references from BuKu imports without treating them
-- as canonical NAVILO Sales invoices. Canonical sales_orders.order_no remains authoritative
-- whenever a Transport customer document has been posted.

alter table public.transport_trips
  add column if not exists source_invoice_no text;

comment on column public.transport_trips.source_invoice_no is
  'Imported legacy/source invoice reference (for example BuKu INVOICE NUMBER). Informational only; canonical NAVILO invoice identity comes from linked sales_orders.';

create index if not exists transport_trips_source_invoice_no_idx
  on public.transport_trips(company_id, source_invoice_no)
  where source_invoice_no is not null;
