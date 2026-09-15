-- Remove the unused duplicate created by a near-simultaneous double submit.
-- The older supplier row is retained as the canonical record.
with ranked_duplicates as (
  select id,
         row_number() over (
           partition by coalesce(company_id, user_id), lower(btrim(name))
           order by created_at, id
         ) as duplicate_rank
  from public.suppliers
  where company_id = (select id from public.companies where name = 'AMK Steels Private Limited')
    and lower(btrim(name)) = 'shalimar steels'
)
delete from public.suppliers s
using ranked_duplicates d
where s.id = d.id
  and d.duplicate_rank > 1
  and not exists (select 1 from public.purchase_orders p where p.supplier_id = s.id)
  and not exists (select 1 from public.consolidated_purchase_invoices c where c.supplier_id = s.id)
  and not exists (select 1 from public.purchase_payment_allocations a where a.supplier_id = s.id);

-- Enforce normalized party-name uniqueness at the database boundary.  The
-- coalesce keeps legacy user-scoped rows protected when company_id is null.
create unique index if not exists customers_scope_normalized_name_uidx
on public.customers (coalesce(company_id, user_id), lower(btrim(name)));

create unique index if not exists suppliers_scope_normalized_name_uidx
on public.suppliers (coalesce(company_id, user_id), lower(btrim(name)));
