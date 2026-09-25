begin;

-- Reconcile legacy production Sales Invoice posting with the centralized
-- posting engine without duplicating General Ledger or party-ledger rows.
do $migration$
declare
  v_oid oid;
  v_def text;
  v_start integer;
  v_end integer;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='post_sales_invoice_core'
    and pg_get_function_identity_arguments(p.oid)='p_order_id uuid';

  if v_oid is null then
    raise exception 'post_sales_invoice_core(uuid) is missing';
  end if;

  v_def:=pg_get_functiondef(v_oid);

  -- Local/current schema is already centralized. Production was reconciled
  -- from its older function body before this migration was committed.
  if position('perform public.post_journal_entry(v_journal_id)' in lower(v_def))=0 then
    raise exception 'Sales posting is not centralized; refusing an unsafe implicit rewrite.';
  end if;

  if position('insert into public.ledgers' in lower(v_def))>0 then
    raise exception 'Sales posting still contains legacy direct General Ledger insertion.';
  end if;

  -- post_journal_entry() calls post_party_ledger_for_journal(). If an older
  -- Sales core still contains its own party-ledger block, remove only that
  -- exact bounded legacy section.
  if position('insert into public.party_ledgers' in lower(v_def))>0 then
    v_start:=position('  -- 24. Customer Party Ledger' in v_def);
    v_end:=position('  -- 25. Final Sales Invoice status/payment snapshot' in v_def);
    if v_start=0 or v_end=0 or v_end<=v_start then
      raise exception 'Could not safely isolate legacy Sales party-ledger block.';
    end if;

    v_def:=substring(v_def from 1 for v_start-1)
      || E'  -- 24. Customer Party Ledger is created centrally by post_journal_entry.\n\n'
      || substring(v_def from v_end);
    execute v_def;
  end if;
end
$migration$;

revoke execute on function public.post_sales_invoice_core(uuid) from public, anon;
grant execute on function public.post_sales_invoice_core(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
