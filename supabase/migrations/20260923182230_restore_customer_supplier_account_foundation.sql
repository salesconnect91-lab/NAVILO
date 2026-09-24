-- Restore the party-to-control-account columns that exist in the live catalog
-- and are required by journal, receipt, payment and opening-balance RPCs.
-- They were part of the pre-versioned live baseline but were absent from the
-- repository's clean-replay foundation.

alter table public.customers
  add column if not exists account_id uuid;

alter table public.suppliers
  add column if not exists account_id uuid;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.customers'::regclass
      and conname = 'customers_account_id_fkey'
  ) then
    alter table public.customers
      add constraint customers_account_id_fkey
      foreign key (account_id)
      references public.chart_of_accounts(id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.suppliers'::regclass
      and conname = 'suppliers_account_id_fkey'
  ) then
    alter table public.suppliers
      add constraint suppliers_account_id_fkey
      foreign key (account_id)
      references public.chart_of_accounts(id);
  end if;
end;
$migration$;

notify pgrst, 'reload schema';
