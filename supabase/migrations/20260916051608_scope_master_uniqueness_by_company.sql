-- Master values may repeat across tenant companies, but must remain unique
-- inside each company. The previous global indexes caused cross-company
-- collisions and violated tenant isolation.

drop index if exists public.categories_name_normalized_uidx;
create unique index categories_name_normalized_uidx
on public.categories (company_id, lower(btrim(name)));

drop index if exists public.items_sku_normalized_uidx;
create unique index items_sku_normalized_uidx
on public.items (company_id, lower(btrim(sku)));

drop index if exists public.warehouses_name_normalized_uidx;
create unique index warehouses_name_normalized_uidx
on public.warehouses (company_id, lower(btrim(name)));

drop index if exists public.uom_name_normalized_uidx;
create unique index uom_name_normalized_uidx
on public.uom (company_id, lower(btrim(name)));

drop index if exists public.uom_symbol_normalized_uidx;
create unique index uom_symbol_normalized_uidx
on public.uom (company_id, lower(btrim(symbol)));

drop index if exists public.transporters_name_normalized_uidx;
create unique index transporters_name_normalized_uidx
on public.transporters (company_id, lower(btrim(name)));

-- This legacy constraint duplicated the warehouse-scoped normalized index and
-- blocked two warehouses from using the same godown name.
alter table public.godowns drop constraint if exists godowns_name_key;
