-- Add a non-stock Service classification to the canonical Item master.
-- This migration intentionally does NOT add or alter any COA/account mapping.
-- Existing Raw/Component/Finished items and their inventory/accounting behavior remain unchanged.

alter table public.items
  add column if not exists is_stock_item boolean not null default true;

update public.items
set is_stock_item = false,
    grade = null,
    size = null,
    weight_per_piece = null,
    warehouse_id = null
where lower(coalesce(type,'')) = 'service';

alter table public.items
  drop constraint if exists items_service_nonstock_guard;

alter table public.items
  add constraint items_service_nonstock_guard
  check (
    lower(coalesce(type,'')) <> 'service'
    or (
      is_stock_item = false
      and grade is null
      and size is null
      and weight_per_piece is null
      and warehouse_id is null
    )
  );

create or replace function public.normalize_item_service_classification()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if lower(coalesce(new.type,'')) = 'service' then
    new.is_stock_item := false;
    new.grade := null;
    new.size := null;
    new.weight_per_piece := null;
    new.warehouse_id := null;
  elsif tg_op = 'INSERT' and new.is_stock_item is null then
    new.is_stock_item := true;
  end if;
  return new;
end
$$;

drop trigger if exists items_service_classification_guard on public.items;
create trigger items_service_classification_guard
before insert or update of type,is_stock_item,grade,size,weight_per_piece,warehouse_id
on public.items
for each row execute function public.normalize_item_service_classification();

comment on column public.items.is_stock_item is
'False for non-stock services. This flag does not define or alter COA/account mappings.';

notify pgrst,'reload schema';
