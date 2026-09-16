drop index if exists public.customers_scope_normalized_name_uidx;
create unique index customers_scope_normalized_name_uidx
  on public.customers (
    coalesce(company_id, user_id),
    lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))
  );

drop index if exists public.suppliers_scope_normalized_name_uidx;
create unique index suppliers_scope_normalized_name_uidx
  on public.suppliers (
    coalesce(company_id, user_id),
    lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))
  );
