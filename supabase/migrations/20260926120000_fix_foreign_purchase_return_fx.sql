-- ============================================================
-- NAVILO PHASE 2
-- ACC-006 FINAL FOREIGN PURCHASE RETURN ACCOUNTING
--
-- Purchase Debit Note rules:
--
-- 1. Currency/rate snapshot comes from original posted purchase.
-- 2. AP + Input VAT amounts originate in purchase/source currency.
-- 3. Inventory reversal is ORIGINAL BOOKED BASE COST.
-- 4. Any difference between converted source subtotal and booked
--    inventory cost is Purchase Return Cost Adjustment (COGS).
--
-- This keeps the journal balanced while preserving the exact
-- base-currency inventory value originally capitalised.
-- ============================================================


-- ------------------------------------------------------------
-- A. EXTEND FX HEADER BRIDGE TO PURCHASE DEBIT NOTES
-- ------------------------------------------------------------

create or replace function public.prepare_invoice_journal_fx_header()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_company uuid := coalesce(new.company_id, public.current_company_id());
  v_base text;
  v_currency text;
  v_rate numeric;
  v_source_entry_no text;
begin
  if new.trans_type not in
       ('Sales Invoice','Purchase','Purchase Debit Note') then
    return new;
  end if;

  if v_company is null then
    return new;
  end if;

  select base_currency_code
    into v_base
  from public.companies
  where id=v_company;

  if v_base is null then
    return new;
  end if;


  -- SALES
  if new.trans_type='Sales Invoice' then

    select
      coalesce(nullif(s.currency_code,''),v_base),
      coalesce(s.exchange_rate,1)
    into v_currency,v_rate
    from public.sales_orders s
    where s.company_id=v_company
      and s.order_no=new.entry_no
    order by s.created_at desc
    limit 1;


  -- PURCHASE
  elsif new.trans_type='Purchase' then

    /*
     * ACC-004 canonical purchase lookup.
     * Purchase journals are numbered PUR-<purchase_order.order_no>.
     */
    v_source_entry_no :=
      case
        when new.entry_no like 'PUR-%'
          then substring(new.entry_no from 5)
        else new.entry_no
      end;

    select
      coalesce(nullif(p.currency_code,''),v_base),
      coalesce(p.exchange_rate,1)
    into v_currency,v_rate
    from public.purchase_orders p
    where p.company_id = v_company
      and p.order_no = v_source_entry_no
    order by p.created_at desc
    limit 1;


  -- PURCHASE DEBIT NOTE
  else

    select
      coalesce(nullif(po.currency_code,''),v_base),
      coalesce(po.exchange_rate,1)
    into v_currency,v_rate
    from public.return_notes rn
    join public.purchase_orders po
      on po.id=rn.purchase_order_id
     and po.company_id=rn.company_id
    where rn.company_id=v_company
      and rn.note_no=new.entry_no
      and rn.note_type='purchase_debit'
    order by rn.created_at desc
    limit 1;

  end if;


  if v_currency is null then
    return new;
  end if;

  if v_currency=v_base then
    new.currency_code:=v_base;
    new.exchange_rate:=1;
  else
    if v_rate is null or v_rate<=0 then
      raise exception
        '% % has no valid locked exchange rate.',
        new.trans_type,
        new.entry_no;
    end if;

    new.currency_code:=v_currency;
    new.exchange_rate:=v_rate;
  end if;

  return new;
end;
$function$;


-- ------------------------------------------------------------
-- B. FX LINE BRIDGE
--
-- Purchase Debit Note:
--
-- AP and VAT are source-currency amounts -> convert to base.
--
-- Inventory is NOT converted here because its final base value
-- is supplied by the return-cost trigger below.
-- ------------------------------------------------------------

create or replace function public.prepare_invoice_journal_line_fx()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_je public.journal_entries%rowtype;
  v_base text;

  v_cogs uuid;
  v_inventory uuid;

  v_source_debit numeric;
  v_source_credit numeric;
begin

  select *
    into v_je
  from public.journal_entries
  where id=new.entry_id;

  if not found
     or v_je.trans_type not in
          ('Sales Invoice','Purchase','Purchase Debit Note') then
    return new;
  end if;


  select base_currency_code
    into v_base
  from public.companies
  where id=v_je.company_id;


  if v_base is null
     or coalesce(v_je.currency_code,v_base)=v_base then

    new.amount_basis:='base_currency';
    new.source_debit:=null;
    new.source_credit:=null;
    new.source_exchange_rate:=null;

    return new;
  end if;


  if v_je.exchange_rate is null
     or v_je.exchange_rate<=0 then
    raise exception
      'Foreign invoice journal % has no positive locked exchange rate.',
      v_je.entry_no;
  end if;


  select account_id
    into v_inventory
  from public.account_mappings
  where user_id=v_je.user_id
    and company_id=v_je.company_id
    and mapping_key='inventory'
  limit 1;


  -- ----------------------------------------------------------
  -- PURCHASE DEBIT NOTE INVENTORY
  --
  -- Inventory is replaced with original booked BASE cost by
  -- enforce_purchase_debit_note_booked_cost().
  -- Do not FX-convert it here.
  -- ----------------------------------------------------------

  if v_je.trans_type='Purchase Debit Note'
     and new.account_id=v_inventory then

    new.amount_basis:='base_currency';
    new.source_debit:=null;
    new.source_credit:=null;
    new.source_exchange_rate:=null;

    return new;
  end if;


  -- Existing sales COGS / inventory are already base-valued.

  if v_je.trans_type='Sales Invoice' then

    select account_id
      into v_cogs
    from public.account_mappings
    where user_id=v_je.user_id
      and company_id=v_je.company_id
      and mapping_key in ('cogs','cost_of_goods_sold')
    order by case when mapping_key='cogs' then 0 else 1 end
    limit 1;

    if new.account_id=v_cogs
       or new.account_id=v_inventory then

      new.amount_basis:='base_currency';
      new.source_debit:=null;
      new.source_credit:=null;
      new.source_exchange_rate:=null;

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
end;
$function$;


-- ------------------------------------------------------------
-- C. FINAL PURCHASE DEBIT NOTE INVENTORY COST + BALANCING
--
-- Runs AFTER all return journal lines exist but BEFORE posting.
--
-- Existing return function initially creates:
--
-- Dr AP        source total
-- Cr Inventory source subtotal
-- Cr Input VAT source tax
--
-- FX line bridge converts AP/VAT.
--
-- This trigger replaces Inventory credit with rn.cost_total,
-- which is already the original booked BASE inventory cost.
--
-- Difference goes through COGS as explicit purchase-return
-- inventory-cost adjustment so journal remains balanced.
-- ------------------------------------------------------------

create or replace function public.enforce_purchase_debit_note_booked_cost()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_je public.journal_entries%rowtype;

  v_inventory uuid;
  v_cogs uuid;

  v_note public.return_notes%rowtype;

  v_inventory_line uuid;

  v_target_inventory numeric;
  v_debits numeric;
  v_credits numeric;
  v_difference numeric;

  v_account_text text;
begin

  select *
    into v_je
  from public.journal_entries
  where id=new.entry_id;

  if not found
     or v_je.trans_type<>'Purchase Debit Note' then
    return new;
  end if;


  select *
    into v_note
  from public.return_notes
  where company_id=v_je.company_id
    and note_no=v_je.entry_no
    and note_type='purchase_debit'
  order by created_at desc
  limit 1;

  if not found then
    raise exception
      'Purchase Debit Note % has no matching return note.',
      v_je.entry_no;
  end if;


  select account_id
    into v_inventory
  from public.account_mappings
  where user_id=v_je.user_id
    and company_id=v_je.company_id
    and mapping_key='inventory'
  limit 1;


  select account_id
    into v_cogs
  from public.account_mappings
  where user_id=v_je.user_id
    and company_id=v_je.company_id
    and mapping_key in ('cogs','cost_of_goods_sold')
  order by case when mapping_key='cogs' then 0 else 1 end
  limit 1;


  if v_inventory is null then
    raise exception
      'Inventory account mapping is missing for Purchase Debit Note.';
  end if;

  if v_cogs is null then
    raise exception
      'COGS account mapping is missing for Purchase Debit Note cost adjustment.';
  end if;


  /*
   * return_notes.cost_total is populated from return_note_lines
   * using get_purchase_return_booked_unit_cost().
   */
  v_target_inventory:=round(coalesce(v_note.cost_total,0),2);

  if v_target_inventory<=0 then
    raise exception
      'Purchase Debit Note % has no positive booked inventory cost.',
      v_note.note_no;
  end if;


  select id
    into v_inventory_line
  from public.journal_lines
  where entry_id=v_je.id
    and company_id=v_je.company_id
    and account_id=v_inventory
  order by id
  limit 1;

  if v_inventory_line is null then
    raise exception
      'Purchase Debit Note % has no Inventory journal line.',
      v_note.note_no;
  end if;


  /*
   * Replace inventory reversal with booked BASE value.
   */
  update public.journal_lines
  set debit=0,
      credit=v_target_inventory,
      base_debit=0,
      base_credit=v_target_inventory,
      source_debit=null,
      source_credit=null,
      source_exchange_rate=null,
      amount_basis='base_currency'
  where id=v_inventory_line;


  /*
   * Recalculate journal difference after inventory correction.
   */
  select
    round(coalesce(sum(debit),0),2),
    round(coalesce(sum(credit),0),2)
  into v_debits,v_credits
  from public.journal_lines
  where entry_id=v_je.id;


  v_difference:=round(v_debits-v_credits,2);


  /*
   * Positive difference:
   * debit > credit -> credit COGS adjustment.
   *
   * Negative difference:
   * credit > debit -> debit COGS adjustment.
   */
  if abs(v_difference)>0.009 then

    select code||' - '||name
      into v_account_text
    from public.chart_of_accounts
    where id=v_cogs
      and company_id=v_je.company_id
      and is_active
      and not is_group;

    if v_account_text is null then
      raise exception
        'COGS account for Purchase Debit Note adjustment is invalid.';
    end if;


    insert into public.journal_lines(
      user_id,
      company_id,
      business_unit_id,
      operating_location_id,
      entry_id,
      account_id,
      account,
      debit,
      credit,
      base_debit,
      base_credit,
      amount_basis
    )
    values(
      v_je.user_id,
      v_je.company_id,
      v_je.business_unit_id,
      v_je.operating_location_id,
      v_je.id,
      v_cogs,
      v_account_text,

      case
        when v_difference<0 then abs(v_difference)
        else 0
      end,

      case
        when v_difference>0 then v_difference
        else 0
      end,

      case
        when v_difference<0 then abs(v_difference)
        else 0
      end,

      case
        when v_difference>0 then v_difference
        else 0
      end,

      'base_currency'
    );

  end if;


  select
    round(coalesce(sum(debit),0),2),
    round(coalesce(sum(credit),0),2)
  into v_debits,v_credits
  from public.journal_lines
  where entry_id=v_je.id;


  if abs(v_debits-v_credits)>0.009 then
    raise exception
      'Purchase Debit Note % remains unbalanced after booked-cost reconciliation: debit %, credit %.',
      v_note.note_no,
      v_debits,
      v_credits;
  end if;


  return new;
end;
$function$;


-- ------------------------------------------------------------
-- D. RUN RECONCILIATION IMMEDIATELY BEFORE JOURNAL POST
--
-- post_journal_entry receives journal UUID. We do NOT rewrite
-- that large accounting function. Instead trigger when JE
-- changes from draft -> posted would be too late because
-- post_journal_entry validates lines first.
--
-- Therefore hook the LAST inserted purchase-return line.
--
-- Input VAT is the final line when tax exists; Inventory is
-- final when no tax exists.
--
-- To avoid ordering dependence, use a DEFERRABLE constraint
-- trigger on journal_lines. The function is idempotent and
-- only acts while the JE is still draft.
-- ------------------------------------------------------------

create or replace function public.reconcile_purchase_debit_note_line()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_type text;
  v_status text;
begin

  select trans_type,status
    into v_type,v_status
  from public.journal_entries
  where id=new.entry_id;

  if v_type='Purchase Debit Note'
     and v_status='draft' then
    perform public.enforce_purchase_debit_note_booked_cost();
  end if;

  return new;
end;
$function$;


-- The function above cannot directly invoke a trigger function.
-- Use a normal callable reconciliation function instead.

drop function if exists public.enforce_purchase_debit_note_booked_cost();

create or replace function public.enforce_purchase_debit_note_booked_cost(
  p_entry_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_je public.journal_entries%rowtype;
  v_inventory uuid;
  v_cogs uuid;
  v_note public.return_notes%rowtype;
  v_inventory_line uuid;
  v_target_inventory numeric;
  v_debits numeric;
  v_credits numeric;
  v_difference numeric;
  v_account_text text;
begin

  select *
    into v_je
  from public.journal_entries
  where id=p_entry_id
  for update;

  if not found
     or v_je.trans_type<>'Purchase Debit Note'
     or v_je.status<>'draft' then
    return;
  end if;


  select *
    into v_note
  from public.return_notes
  where company_id=v_je.company_id
    and note_no=v_je.entry_no
    and note_type='purchase_debit'
  order by created_at desc
  limit 1;

  if not found then
    raise exception
      'Purchase Debit Note % has no matching return note.',
      v_je.entry_no;
  end if;


  select account_id into v_inventory
  from public.account_mappings
  where user_id=v_je.user_id
    and company_id=v_je.company_id
    and mapping_key='inventory'
  limit 1;


  select account_id into v_cogs
  from public.account_mappings
  where user_id=v_je.user_id
    and company_id=v_je.company_id
    and mapping_key in ('cogs','cost_of_goods_sold')
  order by case when mapping_key='cogs' then 0 else 1 end
  limit 1;


  if v_inventory is null or v_cogs is null then
    raise exception
      'Inventory/COGS mapping is missing for Purchase Debit Note.';
  end if;


  v_target_inventory:=round(coalesce(v_note.cost_total,0),2);

  if v_target_inventory<=0 then
    raise exception
      'Purchase Debit Note % has invalid booked inventory cost.',
      v_note.note_no;
  end if;


  select id into v_inventory_line
  from public.journal_lines
  where entry_id=v_je.id
    and company_id=v_je.company_id
    and account_id=v_inventory
  order by id
  limit 1;

  if v_inventory_line is null then
    raise exception
      'Purchase Debit Note % has no Inventory journal line.',
      v_note.note_no;
  end if;


  update public.journal_lines
  set debit=0,
      credit=v_target_inventory,
      base_debit=0,
      base_credit=v_target_inventory,
      source_debit=null,
      source_credit=null,
      source_exchange_rate=null,
      amount_basis='base_currency'
  where id=v_inventory_line;


  /*
   * Remove prior generated adjustment if function is called twice.
   */
  delete from public.journal_lines
  where entry_id=v_je.id
    and account_id=v_cogs
    and amount_basis='purchase_return_cost_adjustment';


  select
    round(coalesce(sum(debit),0),2),
    round(coalesce(sum(credit),0),2)
  into v_debits,v_credits
  from public.journal_lines
  where entry_id=v_je.id;


  v_difference:=round(v_debits-v_credits,2);


  if abs(v_difference)>0.009 then

    select code||' - '||name
      into v_account_text
    from public.chart_of_accounts
    where id=v_cogs
      and company_id=v_je.company_id
      and is_active
      and not is_group;


    insert into public.journal_lines(
      user_id,
      company_id,
      business_unit_id,
      operating_location_id,
      entry_id,
      account_id,
      account,
      debit,
      credit,
      base_debit,
      base_credit,
      amount_basis
    )
    values(
      v_je.user_id,
      v_je.company_id,
      v_je.business_unit_id,
      v_je.operating_location_id,
      v_je.id,
      v_cogs,
      v_account_text,

      case when v_difference<0
        then abs(v_difference) else 0 end,

      case when v_difference>0
        then v_difference else 0 end,

      case when v_difference<0
        then abs(v_difference) else 0 end,

      case when v_difference>0
        then v_difference else 0 end,

      'purchase_return_cost_adjustment'
    );

  end if;


  select
    round(coalesce(sum(debit),0),2),
    round(coalesce(sum(credit),0),2)
  into v_debits,v_credits
  from public.journal_lines
  where entry_id=v_je.id;


  if abs(v_debits-v_credits)>0.009 then
    raise exception
      'Purchase Debit Note % unbalanced after booked-cost reconciliation: debit %, credit %.',
      v_note.note_no,
      v_debits,
      v_credits;
  end if;

end;
$function$;


create or replace function public.reconcile_purchase_debit_note_line()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_type text;
  v_status text;
begin

  select trans_type,status
    into v_type,v_status
  from public.journal_entries
  where id=new.entry_id;

  /*
   * Reconcile after each inserted line.
   *
   * Function is idempotent. However the first AP line alone is
   * incomplete, so only run once Inventory exists and either:
   *   - Input VAT exists, or
   *   - return note has zero tax.
   */
  if v_type='Purchase Debit Note'
     and v_status='draft'
     and exists(
       select 1
       from public.journal_lines jl
       join public.account_mappings am
         on am.account_id=jl.account_id
        and am.company_id=jl.company_id
        and am.mapping_key='inventory'
       where jl.entry_id=new.entry_id
     )
     and (
       exists(
         select 1
         from public.journal_lines jl
         join public.account_mappings am
           on am.account_id=jl.account_id
          and am.company_id=jl.company_id
          and am.mapping_key='input_vat'
         where jl.entry_id=new.entry_id
       )
       or exists(
         select 1
         from public.return_notes rn
         join public.journal_entries je
           on je.entry_no=rn.note_no
          and je.company_id=rn.company_id
         where je.id=new.entry_id
           and coalesce(rn.tax_total,0)=0
       )
     )
  then
    perform public.enforce_purchase_debit_note_booked_cost(new.entry_id);
  end if;

  return new;
end;
$function$;


drop trigger if exists trg_reconcile_purchase_debit_note_line
on public.journal_lines;

create trigger trg_reconcile_purchase_debit_note_line
after insert on public.journal_lines
for each row
execute function public.reconcile_purchase_debit_note_line();


-- ------------------------------------------------------------
-- E. IMPORTANT:
--
-- return_notes totals are only updated AFTER post_journal_entry
-- in the old function, therefore cost_total is still zero while
-- journal lines are being created.
--
-- Use return_note_lines directly instead.
-- ------------------------------------------------------------

create or replace function public.enforce_purchase_debit_note_booked_cost(
  p_entry_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_je public.journal_entries%rowtype;
  v_inventory uuid;
  v_cogs uuid;
  v_note_id uuid;
  v_target_inventory numeric;
  v_inventory_line uuid;
  v_debits numeric;
  v_credits numeric;
  v_difference numeric;
  v_account_text text;
begin

  select *
    into v_je
  from public.journal_entries
  where id=p_entry_id
  for update;

  if not found
     or v_je.trans_type<>'Purchase Debit Note'
     or v_je.status<>'draft' then
    return;
  end if;


  select rn.id
    into v_note_id
  from public.return_notes rn
  where rn.company_id=v_je.company_id
    and rn.note_no=v_je.entry_no
    and rn.note_type='purchase_debit'
  order by rn.created_at desc
  limit 1;

  if v_note_id is null then
    raise exception
      'Purchase Debit Note % has no matching return note.',
      v_je.entry_no;
  end if;


  select round(coalesce(sum(rnl.cost_total),0),2)
    into v_target_inventory
  from public.return_note_lines rnl
  where rnl.note_id=v_note_id
    and rnl.company_id=v_je.company_id;


  if v_target_inventory<=0 then
    raise exception
      'Purchase Debit Note % has no positive booked inventory cost.',
      v_je.entry_no;
  end if;


  select account_id into v_inventory
  from public.account_mappings
  where user_id=v_je.user_id
    and company_id=v_je.company_id
    and mapping_key='inventory'
  limit 1;


  select account_id into v_cogs
  from public.account_mappings
  where user_id=v_je.user_id
    and company_id=v_je.company_id
    and mapping_key in ('cogs','cost_of_goods_sold')
  order by case when mapping_key='cogs' then 0 else 1 end
  limit 1;


  if v_inventory is null or v_cogs is null then
    raise exception
      'Inventory/COGS mapping missing for Purchase Debit Note.';
  end if;


  select id into v_inventory_line
  from public.journal_lines
  where entry_id=v_je.id
    and company_id=v_je.company_id
    and account_id=v_inventory
  order by id
  limit 1;


  if v_inventory_line is null then
    return;
  end if;


  update public.journal_lines
  set debit=0,
      credit=v_target_inventory,
      base_debit=0,
      base_credit=v_target_inventory,
      source_debit=null,
      source_credit=null,
      source_exchange_rate=null,
      amount_basis='base_currency'
  where id=v_inventory_line;


  delete from public.journal_lines
  where entry_id=v_je.id
    and account_id=v_cogs
    and amount_basis='purchase_return_cost_adjustment';


  select
    round(coalesce(sum(debit),0),2),
    round(coalesce(sum(credit),0),2)
  into v_debits,v_credits
  from public.journal_lines
  where entry_id=v_je.id;


  v_difference:=round(v_debits-v_credits,2);


  if abs(v_difference)>0.009 then

    select code||' - '||name
      into v_account_text
    from public.chart_of_accounts
    where id=v_cogs
      and company_id=v_je.company_id
      and is_active
      and not is_group;


    if v_account_text is null then
      raise exception
        'COGS account for Purchase Debit Note adjustment is invalid.';
    end if;


    insert into public.journal_lines(
      user_id,
      company_id,
      business_unit_id,
      operating_location_id,
      entry_id,
      account_id,
      account,
      debit,
      credit,
      base_debit,
      base_credit,
      amount_basis
    )
    values(
      v_je.user_id,
      v_je.company_id,
      v_je.business_unit_id,
      v_je.operating_location_id,
      v_je.id,
      v_cogs,
      v_account_text,

      case when v_difference<0
        then abs(v_difference) else 0 end,

      case when v_difference>0
        then v_difference else 0 end,

      case when v_difference<0
        then abs(v_difference) else 0 end,

      case when v_difference>0
        then v_difference else 0 end,

      'purchase_return_cost_adjustment'
    );

  end if;


  select
    round(coalesce(sum(debit),0),2),
    round(coalesce(sum(credit),0),2)
  into v_debits,v_credits
  from public.journal_lines
  where entry_id=v_je.id;


  if abs(v_debits-v_credits)>0.009 then
    raise exception
      'Purchase Debit Note % remains unbalanced: debit %, credit %.',
      v_je.entry_no,
      v_debits,
      v_credits;
  end if;

end;
$function$;


-- ------------------------------------------------------------
-- F. INSTALLATION ASSERTIONS
-- ------------------------------------------------------------

do $$
begin

  if not exists(
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='prepare_invoice_journal_fx_header'
      and pg_get_functiondef(p.oid)
          like '%Purchase Debit Note%'
  ) then
    raise exception 'ACC-006 FX header installation failed.';
  end if;


  if not exists(
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='prepare_invoice_journal_line_fx'
      and pg_get_functiondef(p.oid)
          like '%Purchase Debit Note%'
  ) then
    raise exception 'ACC-006 FX line installation failed.';
  end if;


  if not exists(
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname='enforce_purchase_debit_note_booked_cost'
  ) then
    raise exception 'ACC-006 booked-cost reconciliation missing.';
  end if;

end $$;

