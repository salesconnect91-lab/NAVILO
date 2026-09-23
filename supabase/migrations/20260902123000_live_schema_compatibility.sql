-- Bring the legacy live schema up to the minimum security/audit contract
-- required by the accounting-control migrations that follow.

alter table public.audit_logs
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists table_name text,
  add column if not exists record_id uuid,
  add column if not exists performed_email text,
  add column if not exists old_data jsonb,
  add column if not exists new_data jsonb,
  add column if not exists metadata jsonb;

update public.audit_logs
set user_id = (select id from auth.users order by created_at limit 1)
where user_id is null;

create index if not exists audit_logs_user_created_idx
  on public.audit_logs (user_id, created_at desc);
create index if not exists audit_logs_record_idx
  on public.audit_logs (table_name, record_id);

alter table public.audit_logs enable row level security;
drop policy if exists "Users can view own audit logs" on public.audit_logs;
create policy "Users can view own audit logs"
  on public.audit_logs for select to authenticated
  using (auth.uid() = user_id);
revoke all on public.audit_logs from anon;
revoke insert, update, delete, truncate, references, trigger on public.audit_logs from authenticated;
grant select on public.audit_logs to authenticated;

-- `accounts` is retained only as a read-only compatibility source for old invoices.
-- Fresh installs do not create this legacy table, so only harden it when it is present.
do $block$
begin
  if to_regclass('public.accounts') is not null then
    alter table public.accounts enable row level security;
    drop policy if exists "Authenticated users can insert accounts" on public.accounts;
    drop policy if exists "Enable insert for authenticated users only" on public.accounts;
    drop policy if exists "Authenticated users can read legacy accounts" on public.accounts;
    create policy "Authenticated users can read legacy accounts"
      on public.accounts for select to authenticated using (true);
    revoke all on public.accounts from anon;
    revoke insert, update, delete, truncate, references, trigger on public.accounts from authenticated;
    grant select on public.accounts to authenticated;
  end if;
end
$block$;

-- Make the reporting view obey the caller's table policies.
alter view public.customer_invoice_aging set (security_invoker = true);

-- Harden all privileged functions against search-path injection and anonymous calls.
do $block$
declare
  fn record;
  callable text[] := array[
    'apply_stock_movement', 'bulk_load_journal_entries',
    'bulk_post_journal_entries', 'cancel_bank_reconciliation',
    'close_bank_reconciliation', 'close_fiscal_year',
    'complete_work_order', 'create_and_post_return_note',
    'create_bank_reconciliation', 'create_customer_with_ar',
    'create_supplier_with_ap', 'current_erp_role',
    'get_available_hawala_invoices', 'initialize_accounting_year',
    'initialize_default_coa', 'next_purchase_order_no',
    'next_work_order_no', 'pay_supplier', 'post_consolidated_sales_invoice',
    'post_fixed_asset_depreciation', 'post_general_cash_bank_transaction',
    'post_journal_entry', 'post_opening_balances', 'post_purchase_invoice',
    'post_sales_invoice', 'receive_customer_payment',
    'replace_sales_order_hawala_invoices', 'reverse_manual_journal_entry',
    'set_accounting_period_status', 'set_bank_transaction_cleared',
    'set_role_permission', 'transfer_stock_v2'
  ];
begin
  for fn in
    select p.oid, n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('alter function %I.%I(%s) set search_path = public, pg_temp',
      fn.nspname, fn.proname, fn.identity_args);
    execute format('revoke execute on function %I.%I(%s) from public, anon',
      fn.nspname, fn.proname, fn.identity_args);
    if fn.proname = any(callable) then
      execute format('grant execute on function %I.%I(%s) to authenticated',
        fn.nspname, fn.proname, fn.identity_args);
    else
      execute format('revoke execute on function %I.%I(%s) from authenticated',
        fn.nspname, fn.proname, fn.identity_args);
    end if;
  end loop;
end
$block$;

notify pgrst, 'reload schema';
