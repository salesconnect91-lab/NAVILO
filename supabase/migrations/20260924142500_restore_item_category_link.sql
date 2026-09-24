-- The hosted item master already has this link, but the original schema export
-- omitted it. Restore it before stock and margin reports reference category_id.
alter table public.items
  add column if not exists category_id uuid;

create index if not exists idx_items_category_id
  on public.items (category_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.items'::regclass
      and contype = 'f'
      and conkey = array[(select attnum from pg_attribute where attrelid = 'public.items'::regclass and attname = 'category_id')]
  ) then
    alter table public.items
      add constraint items_category_id_fkey
      foreign key (category_id) references public.categories(id) on delete restrict;
  end if;
end $$;
