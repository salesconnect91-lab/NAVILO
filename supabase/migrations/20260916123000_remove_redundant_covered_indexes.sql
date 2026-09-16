-- These non-unique indexes duplicate the exact key of an existing unique
-- index. PostgreSQL can use the unique index for the same lookup, so keeping
-- both only adds write and maintenance overhead.
drop index if exists public.idx_company_profile_company_id;
drop index if exists public.idx_company_settings_company_id;
drop index if exists public.entity_translations_lookup_idx;
drop index if exists public.idx_sales_consolidation_invoices_sales_order;
drop index if exists public.idx_sales_order_hawala_invoice;
