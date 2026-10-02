-- Allow append-only supplier rent adjustment evidence while preserving one original bill per rent.
-- The legacy rent_id-only unique index conflicts with the newer is_adjustment model.
drop index if exists public.transport_rent_supplier_document_uidx;

-- Keep the intended invariants explicit.
create unique index if not exists transport_original_supplier_rent_uq
  on public.transport_supplier_document_rents(rent_id)
  where not is_adjustment;

create unique index if not exists transport_supplier_document_rent_uq
  on public.transport_supplier_document_rents(document_id,rent_id);
