begin;

-- Foreign Sales/Purchase invoice posting bridge.
-- Existing source documents stay in document currency.
-- Generated GL/ledger amounts are base currency, with source audit amounts/rates.
-- Sales COGS + Inventory remain base-cost lines and are never FX-converted again.

create or replace function public.prepare_invoice_journal_fx_header()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_company uuid:=coalesce(new.company_id,public.current_company_id());
  v_base text;
  v_currency text;
  v_rate numeric;
begin
  if new.trans_type not in ('Sales Invoice','Purchase') then return new; end if;
  if v_company is null then return new; end if;

  select base_currency_code into v_base from public.companies where id=v_company;
  if v_base is null then return new; end if;

  if new.trans_type='Sales Invoice' then
    select coalesce(nullif(s.currency_code,''),v_base),coalesce(s.exchange_rate,1)
      into v_currency,v_rate
    from public.sales_orders s
    where s.company_id=v_company and s.order_no=new.entry_no
    order by s.created_at desc limit 1;
  else
    select coalesce(nullif(p.currency_code,''),v_base),coalesce(p.exchange_rate,1)
      into v_currency,v_rate
    from public.purchase_orders p
    where p.company_id=v_company and p.order_no=new.entry_no
    order by p.created_at desc limit 1;
  end if;

  if v_currency is null then return new; end if;
  if v_currency=v_base then
    new.currency_code:=v_base; new.exchange_rate:=1;
  else
    if v_rate is null or v_rate<=0 then
      raise exception '% % has no valid locked exchange rate.',new.trans_type,new.entry_no;
    end if;
    new.currency_code:=v_currency; new.exchange_rate:=v_rate;
  end if;
  return new;
end $$;
revoke all on function public.prepare_invoice_journal_fx_header() from public,anon,authenticated;

drop trigger if exists aa_prepare_invoice_journal_fx_header on public.journal_entries;
create trigger aa_prepare_invoice_journal_fx_header
before insert on public.journal_entries
for each row execute function public.prepare_invoice_journal_fx_header();

create or replace function public.prepare_invoice_journal_line_fx()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_je public.journal_entries%rowtype;
  v_base text;
  v_cogs uuid;
  v_inventory uuid;
  v_source_debit numeric;
  v_source_credit numeric;
begin
  select * into v_je from public.journal_entries where id=new.entry_id;
  if not found or v_je.trans_type not in ('Sales Invoice','Purchase') then return new; end if;

  select base_currency_code into v_base from public.companies where id=v_je.company_id;
  if v_base is null or coalesce(v_je.currency_code,v_base)=v_base then
    new.amount_basis:='base_currency';
    new.source_debit:=null; new.source_credit:=null; new.source_exchange_rate:=null;
    return new;
  end if;
  if v_je.exchange_rate is null or v_je.exchange_rate<=0 then
    raise exception 'Foreign invoice journal % has no positive locked exchange rate.',v_je.entry_no;
  end if;

  -- Sales inventory relief is already valued by NAVILO weighted-average base cost.
  if v_je.trans_type='Sales Invoice' then
    select account_id into v_cogs from public.account_mappings
      where user_id=v_je.user_id and company_id=v_je.company_id
        and mapping_key in ('cogs','cost_of_goods_sold')
      order by case when mapping_key='cogs' then 0 else 1 end limit 1;
    select account_id into v_inventory from public.account_mappings
      where user_id=v_je.user_id and company_id=v_je.company_id and mapping_key='inventory' limit 1;

    if new.account_id=v_cogs or new.account_id=v_inventory then
      new.amount_basis:='base_currency';
      new.source_debit:=null; new.source_credit:=null; new.source_exchange_rate:=null;
      return new;
    end if;
  end if;

  v_source_debit:=round(coalesce(new.debit,0),2);
  v_source_credit:=round(coalesce(new.credit,0),2);
  new.source_debit:=v_source_debit;
  new.source_credit:=v_source_credit;
  new.debit:=round(v_source_debit*v_je.exchange_rate,2);
  new.credit:=round(v_source_credit*v_je.exchange_rate,2);
  new.base_debit:=new.debit;
  new.base_credit:=new.credit;
  new.amount_basis:='source_currency';
  new.source_exchange_rate:=v_je.exchange_rate;
  return new;
end $$;
revoke all on function public.prepare_invoice_journal_line_fx() from public,anon,authenticated;

drop trigger if exists aa_prepare_invoice_journal_line_fx on public.journal_lines;
create trigger aa_prepare_invoice_journal_line_fx
before insert on public.journal_lines
for each row execute function public.prepare_invoice_journal_line_fx();

-- Sales used a legacy status->ledger order. Foreign-posting integrity requires
-- ledger rows to exist before status becomes posted. Reuse the centralized
-- post_journal_entry engine, which already enforces balance, tenant scope,
-- ledger uniqueness and party-ledger rules.
do $migration$
declare
  v_oid oid;
  v_def text;
  v_old text;
  v_new text;
  v_fixed text;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='post_sales_invoice_core'
    and pg_get_function_identity_arguments(p.oid)='p_order_id uuid';
  if v_oid is null then raise exception 'post_sales_invoice_core(uuid) is missing'; end if;

  v_def:=pg_get_functiondef(v_oid);
  v_old:=$old$
  update public.journal_entries
  set status = 'posted'
  where id = v_journal_id
    and user_id = v_user_id and company_id = public.current_company_id()
    and status = 'draft';

  if not found then
    raise exception
      'Failed to finalize Sales Invoice journal.';
  end if;


  -- ----------------------------------------------------------
  -- 21. General Ledger from finalized journal
  -- ----------------------------------------------------------

  insert into public.ledgers (
    user_id,
    account_id,
    entry_date,
    description,
    debit,
    credit,
    journal_entry_id,
    journal_line_id
  )
  select
    v_user_id,
    jl.account_id,
    v_order.order_date,
    v_description,
    jl.debit,
    jl.credit,
    v_journal_id,
    jl.id
  from public.journal_lines jl
  where jl.entry_id = v_journal_id;
$old$;
  v_new:=$new$
  perform public.post_journal_entry(v_journal_id);
$new$;

  if position(v_new in v_def)>0 and position(v_old in v_def)=0 then return; end if;
  v_fixed:=replace(v_def,v_old,v_new);
  if v_fixed=v_def then
    raise exception 'Sales centralized posting patch pattern did not match current function.';
  end if;
  execute v_fixed;
end
$migration$;

revoke all on function public.post_sales_invoice_core(uuid) from public,anon;

notify pgrst,'reload schema';
commit;
