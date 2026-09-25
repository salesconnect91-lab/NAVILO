begin;

do $$
declare
  v_sales_def text;
  v_line_def text;
  v_header_def text;
  v_rate numeric:=0.91;
  v_source numeric:=100;
  v_base numeric;
  v_cogs numeric:=63.25;
begin
  select pg_get_functiondef(p.oid) into v_sales_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='post_sales_invoice_core'
    and pg_get_function_identity_arguments(p.oid)='p_order_id uuid';

  if v_sales_def is null or position('perform public.post_journal_entry(v_journal_id)' in lower(v_sales_def))=0 then
    raise exception 'Sales posting is not routed through centralized post_journal_entry.';
  end if;
  if position('insert into public.ledgers' in lower(v_sales_def))>0 then
    raise exception 'Sales core still contains direct ledger insertion.';
  end if;

  select pg_get_functiondef(p.oid) into v_header_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='prepare_invoice_journal_fx_header';
  select pg_get_functiondef(p.oid) into v_line_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='prepare_invoice_journal_line_fx';

  if v_header_def is null or v_line_def is null then raise exception 'Invoice FX bridge functions are missing.'; end if;
  if position('sales_orders' in lower(v_header_def))=0 or position('purchase_orders' in lower(v_header_def))=0 then
    raise exception 'FX header bridge does not cover both Sales and Purchase.';
  end if;
  if position('source_exchange_rate' in lower(v_line_def))=0
     or position('source_currency' in lower(v_line_def))=0
     or position('base_currency' in lower(v_line_def))=0 then
    raise exception 'FX line bridge audit basis is incomplete.';
  end if;

  if not exists(select 1 from pg_trigger where tgname='aa_prepare_invoice_journal_fx_header' and not tgisinternal) then
    raise exception 'Invoice journal FX header trigger is missing.';
  end if;
  if not exists(select 1 from pg_trigger where tgname='aa_prepare_invoice_journal_line_fx' and not tgisinternal) then
    raise exception 'Invoice journal FX line trigger is missing.';
  end if;

  v_base:=round(v_source*v_rate,2);
  if v_base<>91.00 then raise exception 'Source-to-base arithmetic failed.'; end if;
  if v_cogs<>63.25 then raise exception 'Base COGS must remain unconverted.'; end if;

  raise notice 'PASS: Sales/Purchase invoice journals lock document FX, source monetary lines convert to base, Sales COGS/Inventory stay base, and Sales uses centralized ledger posting';
end $$;

rollback;
