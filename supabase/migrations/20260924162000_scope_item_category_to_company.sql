-- Require an item's category to belong to the same tenant. NOT VALID avoids
-- rewriting or rejecting historical item rows, while enforcing new writes.
create unique index if not exists categories_id_company_id_unique
  on public.categories (id, company_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.items'::regclass
      and conname = 'items_category_same_company_fkey'
  ) then
    alter table public.items
      add constraint items_category_same_company_fkey
      foreign key (category_id, company_id)
      references public.categories (id, company_id)
      on delete restrict not valid;
  end if;
end $$;
