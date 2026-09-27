-- Preserve historical relationships when a referenced master is deleted.
-- Only constraints whose parent is a NAVILO master are considered. In particular,
-- document-line cascades and auth.users lifecycle constraints are untouched.
do $$
declare
  fk record;
  changed integer := 0;
begin
  for fk in
    select c.conrelid::regclass as child_table, c.conname,
           pg_get_constraintdef(c.oid) as definition
    from pg_constraint c
    join pg_class parent on parent.oid = c.confrelid
    join pg_namespace n on n.oid = parent.relnamespace
    where c.contype = 'f' and n.nspname = 'public'
      and parent.relname = any(array[
        'customers','suppliers','items','categories','uom','warehouses',
        'godowns','transporters','employees','charge_master',
        'chart_of_accounts','business_units','branches','operating_locations',
        'service_parties','tax_rates','companies'
      ])
      and c.confdeltype in ('c','n','d') -- CASCADE, SET NULL, SET DEFAULT
      -- Company ownership and configuration cleanup is a separate lifecycle.
      and not (parent.relname = 'companies')
  loop
    execute format('alter table %s drop constraint %I', fk.child_table, fk.conname);
    execute format('alter table %s add constraint %I %s', fk.child_table,
                   fk.conname,
                   regexp_replace(fk.definition,
                     ' ON DELETE (CASCADE|SET NULL|SET DEFAULT)',
                     ' ON DELETE RESTRICT'));
    changed := changed + 1;
  end loop;
  raise notice 'Restricted % master foreign keys', changed;
end $$;

-- Charge documents refer to a company-scoped text key rather than charge_master.id.
-- Check the original company and key without consulting the caller's RLS visibility.
create or replace function public.prevent_referenced_charge_master_delete()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  source_table regclass;
  found_reference boolean;
begin
  foreach source_table in array array[
    to_regclass('public.sales_order_charges'),
    to_regclass('public.purchase_order_charges'),
    to_regclass('public.consolidated_sales_invoice_charges'),
    to_regclass('public.consolidated_purchase_invoice_charges'),
    to_regclass('public.hawala_invoice_charges')
  ] loop
    if source_table is null then continue; end if;
    -- Some legacy charge tables predate company_id; their parent document
    -- remains protected by the FK migration, but keys need a conservative guard.
    if exists (select 1 from pg_attribute
               where attrelid = source_table and attname = 'charge_key'
                 and not attisdropped) then
      if exists (select 1 from pg_attribute
                 where attrelid = source_table and attname = 'company_id'
                   and not attisdropped) then
        execute format('select exists(select 1 from %s where charge_key=$1 and company_id is not distinct from $2)',source_table)
          into found_reference using old.charge_key, old.company_id;
      else
        -- Without tenant ownership, a same-named key cannot safely be
        -- disambiguated. Reject deletion rather than risk lost history.
        execute format('select exists(select 1 from %s where charge_key=$1)',source_table)
          into found_reference using old.charge_key;
      end if;
      if found_reference then
        raise exception using errcode='23503',
          message='This record has transaction history and cannot be deleted. Deactivate it instead.';
      end if;
    end if;
  end loop;
  return old;
end $$;

revoke all on function public.prevent_referenced_charge_master_delete() from public;
drop trigger if exists trg_prevent_referenced_charge_master_delete on public.charge_master;
create trigger trg_prevent_referenced_charge_master_delete
before delete on public.charge_master for each row
execute function public.prevent_referenced_charge_master_delete();

-- Items keep a legacy unit symbol instead of a uom_id FK.
create or replace function public.prevent_referenced_uom_delete()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.items i
             where i.unit = old.symbol
               and i.company_id is not distinct from old.company_id) then
    raise exception using errcode='23503',
      message='This record has transaction history and cannot be deleted. Deactivate it instead.';
  end if;
  return old;
end $$;
revoke all on function public.prevent_referenced_uom_delete() from public;
drop trigger if exists trg_prevent_referenced_uom_delete on public.uom;
create trigger trg_prevent_referenced_uom_delete
before delete on public.uom for each row
execute function public.prevent_referenced_uom_delete();
