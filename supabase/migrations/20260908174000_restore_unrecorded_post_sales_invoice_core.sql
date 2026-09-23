-- This SECURITY DEFINER routine existed in production without a recorded creator.
-- Exact definition recovered read-only with pg_get_functiondef; later ACL and
-- hardening migrations remain authoritative.

CREATE OR REPLACE FUNCTION public.post_sales_invoice_core(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid;

  v_order public.sales_orders%rowtype;
  v_customer public.customers%rowtype;

  v_ar_account uuid;
  v_cash_account uuid;
  v_bank_account uuid;
  v_sales_account uuid;
  v_cogs_account uuid;
  v_inventory_account uuid;
  v_output_vat_account uuid;
  v_debit_account uuid;

  v_journal_id uuid;

  v_normal_subtotal numeric := 0;
  v_normal_line_tax numeric := 0;
  v_normal_charge_total numeric := 0;
  v_normal_charge_tax numeric := 0;

  v_hawala_subtotal numeric := 0;
  v_hawala_line_tax numeric := 0;
  v_hawala_charge_total numeric := 0;
  v_hawala_charge_tax numeric := 0;

  v_sales_revenue_total numeric := 0;
  v_total_tax numeric := 0;
  v_invoice_total numeric := 0;

  v_normal_cogs numeric := 0;
  v_hawala_cogs numeric := 0;
  v_total_cogs numeric := 0;

  v_stock numeric;
  v_avg_cost numeric;

  v_total_debit numeric := 0;
  v_total_credit numeric := 0;

  v_normal_line_count integer := 0;
  v_hawala_count integer := 0;
  v_hawala_line_count integer := 0;

  v_hawala_refs text := null;
  v_description text;

  r record;
  c record;
BEGIN
  PERFORM public.assert_module_permission('sales', 'post');

  -- ----------------------------------------------------------
  -- 1. Authentication and invoice lock
  -- ----------------------------------------------------------

  select *
  into v_order
  from public.sales_orders
  where id = p_order_id
    and company_id = public.current_company_id()
    and business_unit_id = public.current_business_unit_id()
  for update;

  if not found then
    raise exception 'Sales invoice not found or access denied.';
  end if;

  v_user_id := v_order.user_id;
  if v_user_id is null then
    raise exception 'Invoice owner context is missing.';
  end if;

  if v_order.status = 'posted' then
    raise exception
      'Invoice % is already posted.',
      v_order.order_no;
  end if;


  -- ----------------------------------------------------------
  -- 2. Customer
  -- ----------------------------------------------------------

  if v_order.customer_id is not null then
    select *
    into v_customer
    from public.customers
    where id = v_order.customer_id
      and user_id = v_user_id and company_id = public.current_company_id();

    if not found then
      raise exception 'Selected customer does not exist.';
    end if;
  end if;


  -- ----------------------------------------------------------
  -- 3. Account mappings
  -- ----------------------------------------------------------

  select am.account_id
  into v_ar_account
  from public.account_mappings am
  where am.user_id = v_user_id AND am.company_id = public.current_company_id()
    and am.mapping_key = 'accounts_receivable'
    and am.account_id is not null
  limit 1;

  select am.account_id
  into v_cash_account
  from public.account_mappings am
  where am.user_id = v_user_id AND am.company_id = public.current_company_id()
    and am.mapping_key = 'cash'
    and am.account_id is not null
  limit 1;

  select am.account_id
  into v_bank_account
  from public.account_mappings am
  where am.user_id = v_user_id AND am.company_id = public.current_company_id()
    and am.mapping_key = 'bank'
    and am.account_id is not null
  limit 1;

  select am.account_id
  into v_sales_account
  from public.account_mappings am
  where am.user_id = v_user_id AND am.company_id = public.current_company_id()
    and am.mapping_key = 'sales_revenue'
    and am.account_id is not null
  limit 1;

  if v_sales_account is null then
    select am.account_id
    into v_sales_account
    from public.account_mappings am
    where am.user_id = v_user_id AND am.company_id = public.current_company_id()
      and am.mapping_key = 'sales'
      and am.account_id is not null
    limit 1;
  end if;

  select am.account_id
  into v_cogs_account
  from public.account_mappings am
  where am.user_id = v_user_id AND am.company_id = public.current_company_id()
    and am.mapping_key = 'cogs'
    and am.account_id is not null
  limit 1;

  if v_cogs_account is null then
    select am.account_id
    into v_cogs_account
    from public.account_mappings am
    where am.user_id = v_user_id AND am.company_id = public.current_company_id()
      and am.mapping_key = 'cost_of_goods_sold'
      and am.account_id is not null
    limit 1;
  end if;

  select am.account_id
  into v_inventory_account
  from public.account_mappings am
  where am.user_id = v_user_id AND am.company_id = public.current_company_id()
    and am.mapping_key = 'inventory'
    and am.account_id is not null
  limit 1;

  select am.account_id
  into v_output_vat_account
  from public.account_mappings am
  where am.user_id = v_user_id AND am.company_id = public.current_company_id()
    and am.mapping_key = 'output_vat'
    and am.account_id is not null
  limit 1;

  if v_sales_account is null then
    raise exception
      'Sales Revenue account is not configured.';
  end if;

  if v_inventory_account is null then
    raise exception
      'Inventory account is not configured.';
  end if;

  if v_cogs_account is null then
    raise exception
      'COGS account is not configured.';
  end if;


  -- ----------------------------------------------------------
  -- 4. Debit account
  -- ----------------------------------------------------------

  if lower(coalesce(v_order.payment_mode, 'credit')) = 'cash' then

    v_debit_account :=
      coalesce(v_order.payment_account_id, v_cash_account);

    if v_debit_account is null then
      raise exception 'Cash account is not configured.';
    end if;

  elsif lower(coalesce(v_order.payment_mode, 'credit')) = 'bank' then

    v_debit_account :=
      coalesce(v_order.payment_account_id, v_bank_account);

    if v_debit_account is null then
      raise exception 'Bank account is not configured.';
    end if;

  else

    if v_order.customer_id is null then
      raise exception 'Customer is required for a credit sale.';
    end if;

    v_debit_account :=
      coalesce(
        v_order.customer_account_id,
        v_customer.account_id,
        v_ar_account
      );

    if v_debit_account is null then
      raise exception
        'Customer Accounts Receivable account is not configured.';
    end if;

  end if;


  -- ----------------------------------------------------------
  -- 5. NORMAL MAIN INVOICE ITEMS
  -- ----------------------------------------------------------

  for r in
    select
      sol.id,
      sol.item_id,
      sol.qty,
      sol.unit_price,
      sol.line_total,
      sol.tax_percent,
      sol.godown_id,
      i.name as item_name,
      g.name as godown_name,
      g.warehouse_id
    from public.sales_order_lines sol
    join public.items i
      on i.id = sol.item_id
    join public.godowns g
      on g.id = sol.godown_id
    where sol.order_id = p_order_id
      and sol.user_id = v_user_id AND sol.company_id = public.current_company_id()
    order by sol.id
  loop

    v_normal_line_count := v_normal_line_count + 1;

    if coalesce(r.qty, 0) <= 0 then
      raise exception
        'Invalid quantity for item %.',
        r.item_name;
    end if;

    if r.godown_id is null or r.warehouse_id is null then
      raise exception
        'Valid Godown/Warehouse is required for item %.',
        r.item_name;
    end if;

    v_normal_subtotal :=
      v_normal_subtotal
      + round(
          coalesce(r.line_total, r.qty * r.unit_price, 0),
          2
        );

    v_normal_line_tax :=
      v_normal_line_tax
      + round(
          coalesce(r.line_total, r.qty * r.unit_price, 0)
          * coalesce(r.tax_percent, 0)
          / 100,
          2
        );

    -- Current weighted-average inventory cost.
    v_avg_cost :=
      greatest(
        coalesce(public.get_inventory_avg_cost(r.item_id), 0),
        0
      );

    v_normal_cogs :=
      v_normal_cogs
      + round(r.qty * v_avg_cost, 2);

  end loop;


  -- ----------------------------------------------------------
  -- 6. NORMAL MAIN INVOICE CHARGES
  -- ----------------------------------------------------------

  for c in
    select *
    from public.sales_order_charges
    where order_id = p_order_id
    order by id
  loop

    if coalesce(c.amount, 0) > 0 then

      if c.account_id is null then
        raise exception
          'Charge "%" has no revenue account configured.',
          c.charge_label;
      end if;

      v_normal_charge_total :=
        v_normal_charge_total + coalesce(c.amount, 0);

      v_normal_charge_tax :=
        v_normal_charge_tax
        + round(
            coalesce(c.amount, 0)
            * coalesce(c.tax_percent, 0)
            / 100,
            2
          );

    end if;

  end loop;


  -- ----------------------------------------------------------
  -- 7. LINKED HAWALA VALIDATION + REVENUE/VAT/COGS
  -- ----------------------------------------------------------

  select
    count(*),
    string_agg(h.invoice_no, ', ' order by h.invoice_no)
  into
    v_hawala_count,
    v_hawala_refs
  from public.sales_order_hawala_invoices l
  join public.consolidated_sales_invoices h
    on h.id = l.hawala_invoice_id
  where l.user_id = v_user_id AND l.company_id = public.current_company_id()
    and l.sales_order_id = p_order_id;

  -- Every selected Hawala must remain valid at posting time.
  if exists (
    select 1
    from public.sales_order_hawala_invoices l
    join public.consolidated_sales_invoices h
      on h.id = l.hawala_invoice_id
    where l.user_id = v_user_id AND l.company_id = public.current_company_id()
      and l.sales_order_id = p_order_id
      and (
        h.user_id <> v_user_id
        or h.status <> 'posted'
        or h.customer_id is distinct from v_order.customer_id
      )
  ) then
    raise exception
      'Invalid Hawala link. Hawala must be posted and belong to the same customer.';
  end if;


  -- Hawala item values and frozen COGS.
  for r in
    select
      h.id as hawala_invoice_id,
      h.invoice_no,
      hl.id as hawala_line_id,
      hl.item_id,
      hl.qty,
      hl.line_total,
      hl.tax_percent,
      hl.unit_cost_at_posting,
      hl.cogs_total
    from public.sales_order_hawala_invoices l
    join public.consolidated_sales_invoices h
      on h.id = l.hawala_invoice_id
    join public.consolidated_sales_invoice_lines hl
      on hl.invoice_id = h.id
    where l.user_id = v_user_id AND l.company_id = public.current_company_id()
      and l.sales_order_id = p_order_id
      and h.user_id = v_user_id AND h.company_id = public.current_company_id()
    order by h.invoice_no, hl.id
  loop

    v_hawala_line_count := v_hawala_line_count + 1;

    if r.unit_cost_at_posting is null
       or r.cogs_total is null then
      raise exception
        'Hawala % does not have frozen inventory cost.',
        r.invoice_no;
    end if;

    if not exists (
      select 1
      from public.hawala_pending_stock hp
      where hp.user_id = v_user_id AND hp.company_id = public.current_company_id()
        and hp.hawala_invoice_id = r.hawala_invoice_id
        and hp.hawala_line_id = r.hawala_line_id
        and hp.status = 'pending'
        and hp.qty_remaining = r.qty
    ) then
      raise exception
        'Pending inventory for Hawala % is missing or already cleared.',
        r.invoice_no;
    end if;

    v_hawala_subtotal :=
      v_hawala_subtotal
      + round(coalesce(r.line_total, 0), 2);

    v_hawala_line_tax :=
      v_hawala_line_tax
      + round(
          coalesce(r.line_total, 0)
          * coalesce(r.tax_percent, 0)
          / 100,
          2
        );

    v_hawala_cogs :=
      v_hawala_cogs
      + round(coalesce(r.cogs_total, 0), 2);

  end loop;


  -- Hawala charges use Charge Master revenue mapping.
  for c in
    select
      h.invoice_no,
      hc.charge_key,
      hc.amount,
      hc.tax_percent,
      cm.charge_name,
      cm.revenue_account_id
    from public.sales_order_hawala_invoices l
    join public.consolidated_sales_invoices h
      on h.id = l.hawala_invoice_id
    join public.consolidated_sales_invoice_charges hc
      on hc.invoice_id = h.id
    left join public.charge_master cm
      on cm.user_id = v_user_id AND cm.company_id = public.current_company_id()
     and cm.charge_key = hc.charge_key
    where l.user_id = v_user_id AND l.company_id = public.current_company_id()
      and l.sales_order_id = p_order_id
      and coalesce(hc.amount, 0) > 0
  loop

    if c.revenue_account_id is null then
      raise exception
        'Hawala charge "%" on % has no Charge Master revenue account.',
        coalesce(c.charge_name, c.charge_key),
        c.invoice_no;
    end if;

    v_hawala_charge_total :=
      v_hawala_charge_total
      + round(coalesce(c.amount, 0), 2);

    v_hawala_charge_tax :=
      v_hawala_charge_tax
      + round(
          coalesce(c.amount, 0)
          * coalesce(c.tax_percent, 0)
          / 100,
          2
        );

  end loop;


  -- ----------------------------------------------------------
  -- 8. Final accounting totals
  -- ----------------------------------------------------------

  v_sales_revenue_total :=
      v_normal_subtotal
    + v_hawala_subtotal;

  v_total_tax :=
      v_normal_line_tax
    + v_normal_charge_tax
    + v_hawala_line_tax
    + v_hawala_charge_tax;

  v_invoice_total :=
      v_sales_revenue_total
    + v_normal_charge_total
    + v_hawala_charge_total
    + v_total_tax;

  v_total_cogs :=
      v_normal_cogs
    + v_hawala_cogs;

  if v_normal_line_count = 0
     and v_hawala_count = 0
     and v_normal_charge_total <= 0 then
    raise exception
      'Invoice must contain normal items, charges, or at least one Hawala document.';
  end if;

  if round(v_invoice_total, 2) <= 0 then
    raise exception 'Invoice total must be greater than zero.';
  end if;


  -- ----------------------------------------------------------
  -- 9. Prevent duplicate accounting posting
  -- ----------------------------------------------------------

  if exists (
    select 1
    from public.journal_entries je
    where je.user_id = v_user_id AND je.company_id = public.current_company_id()
      and je.entry_no = v_order.order_no
  ) then
    raise exception
      'Journal entry already exists for invoice %.',
      v_order.order_no;
  end if;


  -- ----------------------------------------------------------
  -- 10. Audit description
  -- ----------------------------------------------------------

  v_description :=
    'Sales Invoice ' || v_order.order_no
    || coalesce(
         ' | ' || nullif((
           select string_agg(i.name || ': ' || btrim(sol.description), '; ' order by sol.id)
           from public.sales_order_lines sol
           join public.items i on i.id = sol.item_id
           where sol.order_id = p_order_id
             and sol.user_id = v_user_id
             and sol.company_id = public.current_company_id()
             and nullif(btrim(sol.description), '') is not null
         ), ''),
         ''
       )
    || coalesce(
         ' | Hawala items: ' || nullif((
           select string_agg(h.invoice_no || ' - ' || i.name || ': ' || btrim(hl.description), '; ' order by h.invoice_no, hl.id)
           from public.sales_order_hawala_invoices l
           join public.consolidated_sales_invoices h on h.id = l.hawala_invoice_id
           join public.consolidated_sales_invoice_lines hl on hl.invoice_id = h.id
           join public.items i on i.id = hl.item_id
           where l.sales_order_id = p_order_id
             and l.user_id = v_user_id
             and l.company_id = public.current_company_id()
             and nullif(btrim(hl.description), '') is not null
         ), ''),
         ''
       );

  if coalesce(v_hawala_refs, '') <> '' then
    v_description :=
      v_description || ' | Hawala: ' || v_hawala_refs;
  end if;


  -- ----------------------------------------------------------
  -- 11. JOURNAL HEADER MUST START AS DRAFT
  -- ----------------------------------------------------------

  insert into public.journal_entries (
    user_id,
    entry_no,
    entry_date,
    description,
    status,
    payment_mode,
    party_name,
    trans_type
  )
  values (
    v_user_id,
    v_order.order_no,
    v_order.order_date,
    v_description,
    'draft',
    coalesce(v_order.payment_mode, 'Credit'),
    coalesce(v_customer.name, 'Cash/Bank Customer'),
    'Sales Invoice'
  )
  returning id into v_journal_id;


  -- ----------------------------------------------------------
  -- 12. Debit Customer / Cash / Bank
  -- ----------------------------------------------------------

  insert into public.journal_lines (
    user_id,
    entry_id,
    account,
    debit,
    credit,
    account_id,
    party_name,
    party_type,
    party_id
  )
  select
    v_user_id,
    v_journal_id,
    coa.code || ' - ' || coa.name,
    round(v_invoice_total, 2),
    0,
    coa.id,
    case
      when lower(coalesce(v_order.payment_mode, 'credit')) = 'credit'
        then v_customer.name
      else 'Cash/Bank'
    end,
    case
      when lower(coalesce(v_order.payment_mode, 'credit')) = 'credit'
        then 'customer'
      else null
    end,
    case
      when lower(coalesce(v_order.payment_mode, 'credit')) = 'credit'
        then v_order.customer_id
      else null
    end
  from public.chart_of_accounts coa
  where coa.id = v_debit_account;


  -- ----------------------------------------------------------
  -- 13. Credit item sales revenue
  -- ----------------------------------------------------------

  if round(v_sales_revenue_total, 2) > 0 then

    insert into public.journal_lines (
      user_id,
      entry_id,
      account,
      debit,
      credit,
      account_id,
      party_name,
      party_type,
      party_id
    )
    select
      v_user_id,
      v_journal_id,
      coa.code || ' - ' || coa.name,
      0,
      round(v_sales_revenue_total, 2),
      coa.id,
      v_customer.name,
      case when v_customer.id is not null then 'customer' else null end,
      v_customer.id
    from public.chart_of_accounts coa
    where coa.id = v_sales_account;

  end if;


  -- ----------------------------------------------------------
  -- 14. Normal Main Invoice charge revenue
  -- ----------------------------------------------------------

  for c in
    select
      soc.account_id,
      soc.charge_label,
      sum(coalesce(soc.amount, 0)) as amount
    from public.sales_order_charges soc
    where soc.order_id = p_order_id
      and soc.account_id is not null
      and coalesce(soc.amount, 0) > 0
    group by soc.account_id, soc.charge_label
  loop

    insert into public.journal_lines (
      user_id,
      entry_id,
      account,
      debit,
      credit,
      account_id,
      party_name,
      party_type,
      party_id
    )
    select
      v_user_id,
      v_journal_id,
      coa.code || ' - ' || coa.name,
      0,
      round(c.amount, 2),
      coa.id,
      v_customer.name,
      case when v_customer.id is not null then 'customer' else null end,
      v_customer.id
    from public.chart_of_accounts coa
    where coa.id = c.account_id;

  end loop;


  -- ----------------------------------------------------------
  -- 15. Hawala charge revenue via Charge Master
  -- ----------------------------------------------------------

  for c in
    select
      cm.revenue_account_id as account_id,
      cm.charge_name as charge_label,
      sum(coalesce(hc.amount, 0)) as amount
    from public.sales_order_hawala_invoices l
    join public.consolidated_sales_invoice_charges hc
      on hc.invoice_id = l.hawala_invoice_id
    join public.charge_master cm
      on cm.user_id = v_user_id AND cm.company_id = public.current_company_id()
     and cm.charge_key = hc.charge_key
    where l.user_id = v_user_id AND l.company_id = public.current_company_id()
      and l.sales_order_id = p_order_id
      and cm.revenue_account_id is not null
      and coalesce(hc.amount, 0) > 0
    group by cm.revenue_account_id, cm.charge_name
  loop

    insert into public.journal_lines (
      user_id,
      entry_id,
      account,
      debit,
      credit,
      account_id,
      party_name,
      party_type,
      party_id
    )
    select
      v_user_id,
      v_journal_id,
      coa.code || ' - ' || coa.name,
      0,
      round(c.amount, 2),
      coa.id,
      v_customer.name,
      case when v_customer.id is not null then 'customer' else null end,
      v_customer.id
    from public.chart_of_accounts coa
    where coa.id = c.account_id;

  end loop;


  -- ----------------------------------------------------------
  -- 16. Output VAT
  -- ----------------------------------------------------------

  if round(v_total_tax, 2) > 0 then

    if v_output_vat_account is null then
      raise exception
        'Output VAT account is not configured.';
    end if;

    insert into public.journal_lines (
      user_id,
      entry_id,
      account,
      debit,
      credit,
      account_id,
      party_name,
      party_type,
      party_id
    )
    select
      v_user_id,
      v_journal_id,
      coa.code || ' - ' || coa.name,
      0,
      round(v_total_tax, 2),
      coa.id,
      v_customer.name,
      case when v_customer.id is not null then 'customer' else null end,
      v_customer.id
    from public.chart_of_accounts coa
    where coa.id = v_output_vat_account;

  end if;


  -- ----------------------------------------------------------
  -- 17. COGS / Inventory
  -- Includes normal + frozen Hawala COGS
  -- ----------------------------------------------------------

  if round(v_total_cogs, 2) > 0 then

    insert into public.journal_lines (
      user_id,
      entry_id,
      account,
      debit,
      credit,
      account_id,
      party_name,
      party_type,
      party_id
    )
    select
      v_user_id,
      v_journal_id,
      coa.code || ' - ' || coa.name,
      round(v_total_cogs, 2),
      0,
      coa.id,
      v_customer.name,
      case when v_customer.id is not null then 'customer' else null end,
      v_customer.id
    from public.chart_of_accounts coa
    where coa.id = v_cogs_account;

    insert into public.journal_lines (
      user_id,
      entry_id,
      account,
      debit,
      credit,
      account_id,
      party_name,
      party_type,
      party_id
    )
    select
      v_user_id,
      v_journal_id,
      coa.code || ' - ' || coa.name,
      0,
      round(v_total_cogs, 2),
      coa.id,
      v_customer.name,
      case when v_customer.id is not null then 'customer' else null end,
      v_customer.id
    from public.chart_of_accounts coa
    where coa.id = v_inventory_account;

  end if;


  -- ----------------------------------------------------------
  -- 18. Existing normal sales charge COST entries
  -- ----------------------------------------------------------

  for c in
    select
      soc.cost_account_id,
      sum(coalesce(soc.cost_amount, 0)) as cost_amount
    from public.sales_order_charges soc
    where soc.order_id = p_order_id
      and soc.cost_account_id is not null
      and coalesce(soc.cost_amount, 0) > 0
    group by soc.cost_account_id
  loop

    insert into public.journal_lines (
      user_id,
      entry_id,
      account,
      debit,
      credit,
      account_id,
      party_name,
      party_type,
      party_id
    )
    select
      v_user_id,
      v_journal_id,
      coa.code || ' - ' || coa.name,
      round(c.cost_amount, 2),
      0,
      coa.id,
      v_customer.name,
      case when v_customer.id is not null then 'customer' else null end,
      v_customer.id
    from public.chart_of_accounts coa
    where coa.id = c.cost_account_id;

  end loop;


  -- ----------------------------------------------------------
  -- 19. Verify journal BEFORE posting it
  -- ----------------------------------------------------------

  select
    coalesce(sum(jl.debit), 0),
    coalesce(sum(jl.credit), 0)
  into
    v_total_debit,
    v_total_credit
  from public.journal_lines jl
  where jl.entry_id = v_journal_id;

  if abs(
    round(v_total_debit, 2)
    - round(v_total_credit, 2)
  ) >= 0.01 then
    raise exception
      'Journal is not balanced. Debit: %, Credit: %.',
      round(v_total_debit, 2),
      round(v_total_credit, 2);
  end if;


  -- ----------------------------------------------------------
  -- 20. POST JOURNAL
  -- 0037 guards allow this trusted SECURITY DEFINER transition.
  -- ----------------------------------------------------------

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


  -- ----------------------------------------------------------
  -- 22. NORMAL Main Invoice physical stock OUT
  -- Hawala items are intentionally NOT included here.
  -- ----------------------------------------------------------

  for r in
    select
      sol.item_id,
      sol.qty,
      sol.godown_id,
      i.name as item_name,
      g.name as godown_name,
      g.warehouse_id
    from public.sales_order_lines sol
    join public.items i
      on i.id = sol.item_id
    join public.godowns g
      on g.id = sol.godown_id
    where sol.order_id = p_order_id
      and sol.user_id = v_user_id AND sol.company_id = public.current_company_id()
  loop

    select ws.quantity
    into v_stock
    from public.warehouse_stock ws
    where ws.user_id = v_user_id AND ws.company_id = public.current_company_id() AND ws.business_unit_id = public.current_business_unit_id()
      and ws.item_id = r.item_id
      and ws.warehouse_id = r.warehouse_id
      and ws.godown_id = r.godown_id
    for update;

    if coalesce(v_stock, 0) < r.qty then
      raise exception
        'Insufficient stock for % in Godown %. Available: %, Required: %.',
        r.item_name,
        r.godown_name,
        coalesce(v_stock, 0),
        r.qty;
    end if;

    update public.warehouse_stock
    set
      quantity = quantity - r.qty,
      godown = r.godown_name,
      updated_at = now()
    where user_id = v_user_id and company_id = public.current_company_id() and business_unit_id = public.current_business_unit_id()
      and item_id = r.item_id
      and warehouse_id = r.warehouse_id
      and godown_id = r.godown_id;

    insert into public.stock_movements (
      user_id,
      item_id,
      type,
      qty,
      reference,
      godown,
      warehouse_id,
      godown_id
    )
    values (
      v_user_id,
      r.item_id,
      'out',
      r.qty,
      v_order.order_no,
      r.godown_name,
      r.warehouse_id,
      r.godown_id
    );

  end loop;


  -- ----------------------------------------------------------
  -- 23. CLEAR HAWALA PENDING INVENTORY
  --
  -- IMPORTANT:
  -- No warehouse_stock update here.
  -- Physical OUT already happened when Hawala was posted.
  -- ----------------------------------------------------------

  update public.hawala_pending_stock hp
  set
    qty_remaining = 0,
    value_remaining = 0,
    status = 'cleared',
    cleared_at = now(),
    updated_at = now()
  where hp.user_id = v_user_id AND hp.company_id = public.current_company_id()
    and hp.status = 'pending'
    and exists (
      select 1
      from public.sales_order_hawala_invoices l
      where l.user_id = v_user_id AND l.company_id = public.current_company_id()
        and l.sales_order_id = p_order_id
        and l.hawala_invoice_id = hp.hawala_invoice_id
    );


  -- ----------------------------------------------------------
  -- 24. Customer Party Ledger
  -- ----------------------------------------------------------

  if v_order.customer_id is not null
     and lower(coalesce(v_order.payment_mode, 'credit')) = 'credit'
  then

    insert into public.party_ledgers (
      user_id,
      party_type,
      party_id,
      entry_date,
      description,
      reference,
      debit,
      credit,
      balance,
      journal_entry_id
    )
    values (
      v_user_id,
      'customer',
      v_order.customer_id,
      v_order.order_date,
      v_description,
      v_order.order_no,
      round(v_invoice_total, 2),
      0,
      round(v_invoice_total, 2),
      v_journal_id
    );

  end if;


  -- ----------------------------------------------------------
  -- 25. Final Sales Invoice status/payment snapshot
  -- ----------------------------------------------------------

  update public.sales_orders
  set
    status = 'posted',
    total = round(v_invoice_total, 2),

    paid_amount =
      case
        when lower(coalesce(payment_mode, 'credit'))
             in ('cash', 'bank')
          then round(v_invoice_total, 2)
        else coalesce(paid_amount, 0)
      end,

    outstanding_amount =
      case
        when lower(coalesce(payment_mode, 'credit'))
             in ('cash', 'bank')
          then 0
        else greatest(
          round(v_invoice_total, 2)
          - coalesce(paid_amount, 0),
          0
        )
      end,

    payment_status =
      case
        when lower(coalesce(payment_mode, 'credit'))
             in ('cash', 'bank')
          then 'paid'

        when coalesce(paid_amount, 0)
             >= round(v_invoice_total, 2)
          then 'paid'

        when coalesce(paid_amount, 0) > 0
          then 'partial'

        else 'unpaid'
      end

  where id = p_order_id
    and user_id = v_user_id and company_id = public.current_company_id();


  -- ----------------------------------------------------------
  -- 26. Result
  -- ----------------------------------------------------------

  return jsonb_build_object(
    'success', true,

    'order_id', p_order_id,
    'order_no', v_order.order_no,

    'journal_entry_id', v_journal_id,
    'journal_status', 'posted',

    'normal_subtotal', round(v_normal_subtotal, 2),
    'hawala_subtotal', round(v_hawala_subtotal, 2),

    'normal_charges', round(v_normal_charge_total, 2),
    'hawala_charges', round(v_hawala_charge_total, 2),

    'tax_total', round(v_total_tax, 2),
    'invoice_total', round(v_invoice_total, 2),

    'normal_cogs', round(v_normal_cogs, 2),
    'hawala_cogs', round(v_hawala_cogs, 2),
    'total_cogs', round(v_total_cogs, 2),

    'normal_line_count', v_normal_line_count,
    'hawala_count', v_hawala_count,
    'hawala_line_count', v_hawala_line_count,

    'hawala_references', v_hawala_refs,

    'normal_stock_out', true,
    'hawala_second_stock_out', false,
    'hawala_pending_cleared', v_hawala_count > 0,

    'accounting_posted', true
  );

end;
$function$;

revoke all on function public.post_sales_invoice_core(uuid) from public, anon;
