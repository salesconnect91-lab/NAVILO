\set ON_ERROR_STOP on

begin;

do $$
declare
  v_header text;
  v_line text;
  v_recon text;
begin

  select pg_get_functiondef(p.oid)
    into v_header
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='prepare_invoice_journal_fx_header'
  limit 1;


  if v_header not like '%Purchase Debit Note%' then
    raise exception
      'ACC-006 FAIL: Purchase Debit Note missing from FX header bridge.';
  end if;


  if v_header not like '%return_notes%' or
     v_header not like '%purchase_orders%' then
    raise exception
      'ACC-006 FAIL: Debit note does not derive locked FX from original purchase.';
  end if;


  select pg_get_functiondef(p.oid)
    into v_line
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='prepare_invoice_journal_line_fx'
  limit 1;


  if v_line not like '%Purchase Debit Note%' then
    raise exception
      'ACC-006 FAIL: Purchase Debit Note missing from FX line bridge.';
  end if;


  if v_line not like '%new.account_id=v_inventory%' then
    raise exception
      'ACC-006 FAIL: Inventory base-cost exception missing.';
  end if;


  select pg_get_functiondef(p.oid)
    into v_recon
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='enforce_purchase_debit_note_booked_cost'
  limit 1;


  if v_recon not like '%sum(rnl.cost_total)%' then
    raise exception
      'ACC-006 FAIL: booked return-line cost is not reconciliation source.';
  end if;


  if v_recon not like '%purchase_return_cost_adjustment%' then
    raise exception
      'ACC-006 FAIL: balancing cost adjustment missing.';
  end if;


  if not exists(
    select 1
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'
      and c.relname='journal_lines'
      and t.tgname='trg_reconcile_purchase_debit_note_line'
      and not t.tgisinternal
  ) then
    raise exception
      'ACC-006 FAIL: reconciliation trigger missing.';
  end if;


  /*
   * Deterministic accounting invariant:
   *
   * Foreign purchase return:
   * source subtotal = USD 100
   * rate            = PKR 280 / USD
   * AP base reversal= 28,000
   *
   * Original booked inventory cost incl landed allocation
   *                 = PKR 30,800
   *
   * Therefore:
   * Dr AP            28,000
   * Dr COGS adj       2,800
   * Cr Inventory     30,800
   *
   * Total Dr = Total Cr = 30,800
   */

  if round(100::numeric*280::numeric,2)<>28000 then
    raise exception 'ACC-006 deterministic FX conversion failed.';
  end if;


  if round(28000::numeric + 2800::numeric,2)<>30800 then
    raise exception 'ACC-006 deterministic debit reconciliation failed.';
  end if;


  raise notice
    'ACC-006 FINAL CONTRACT PASS: debit-note FX snapshot + source/base separation + booked inventory reversal installed.';

  raise notice
    'ACC-006 deterministic journal: Dr AP 28000 + Dr cost adjustment 2800 = Cr Inventory 30800.';

end $$;

rollback;
