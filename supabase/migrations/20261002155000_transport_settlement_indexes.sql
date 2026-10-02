-- Speed up canonical supplier/customer settlement and journal posting lookups.
-- Additive indexes only; no accounting logic or guards are changed.
create index if not exists purchase_payment_allocations_document_scope_idx
on public.purchase_payment_allocations
(user_id,company_id,business_unit_id,operating_location_id,purchase_order_id);

create index if not exists journal_entries_payment_number_scope_idx
on public.journal_entries
(user_id,company_id,business_unit_id,operating_location_id,entry_no);

create index if not exists journal_lines_entry_scope_idx
on public.journal_lines
(entry_id,user_id,company_id,business_unit_id);

create index if not exists ledgers_journal_scope_idx
on public.ledgers
(journal_entry_id,user_id,company_id,business_unit_id);

create index if not exists transport_supplier_documents_party_scope_idx
on public.transport_supplier_documents
(company_id,business_unit_id,supplier_id,purchase_order_id);

create index if not exists transport_service_cost_links_order_scope_idx
on public.transport_service_cost_links
(company_id,business_unit_id,purchase_order_id);