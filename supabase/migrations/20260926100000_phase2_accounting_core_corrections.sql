begin;

-- ============================================================
-- NAVILO PHASE 2 ACCOUNTING CORE CORRECTIONS
--
-- ACC-004:
--   Purchase journal entry_no is PUR-<order_no>, while the FX
--   header bridge historically looked up raw order_no.
--
-- ACC-009:
--   Discount bootstrap used ON CONFLICT(user_id,mapping_key)
--   without a matching unique/exclusion constraint in the
--   replayed schema.
--
-- ACC-007:
--   Discount accounts are intentionally protected from manual
--   entry, but post_journal_entry historically rejected them
--   even when the journal was system-generated.
--
-- ACC-008:
--   Mapped-account lifecycle validation omitted the two
--   commercial discount mapping keys.
-- ============================================================


-- ============================================================
-- ACC-004 — FOREIGN PURCHASE JOURNAL HEADER RESOLUTION
-- ============================================================

create or replace function public.prepare_invoice_journal_fx_header()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $function$
declare
  v_company uuid := coalesce(new.company_id, public.current_company_id());
  v_base text;
  v_currency text;
  v_rate numeric;
  v_source_entry_no text;
begin
  if new.trans_type not in ('Sales Invoice','Purchase') then
    return new;
  end if;

  if v_company is null then
    return new;
  end if;

  select base_currency_code
  into v_base
  from public.companies
  where id = v_company;

  if v_base is null then
    return new;
  end if;

  if new.trans_type = 'Sales Invoice' then

    select
      coalesce(nullif(s.currency_code,''), v_base),
      coalesce(s.exchange_rate,1)
    into
      v_currency,
      v_rate
    from public.sales_orders s
    where s.company_id = v_company
      and s.order_no = new.entry_no
    order by s.created_at desc
    limit 1;

  else

    /*
     * Purchase journals are deliberately numbered:
     *
     *     PUR-<purchase_order.order_no>
     *
     * Resolve the source document using the normalized
     * source number instead of comparing purchase_orders.order_no
     * directly with journal_entries.entry_no.
     */
    v_source_entry_no :=
      case
        when new.entry_no like 'PUR-%'
          then substring(new.entry_no from 5)
        else new.entry_no
      end;

    select
      coalesce(nullif(p.currency_code,''), v_base),
      coalesce(p.exchange_rate,1)
    into
      v_currency,
      v_rate
    from public.purchase_orders p
    where p.company_id = v_company
      and p.order_no = v_source_entry_no
    order by p.created_at desc
    limit 1;

  end if;

  if v_currency is null then
    return new;
  end if;

  if v_currency = v_base then
    new.currency_code := v_base;
    new.exchange_rate := 1;
  else
    if v_rate is null or v_rate <= 0 then
      raise exception
        '% % has no valid locked exchange rate.',
        new.trans_type,
        new.entry_no;
    end if;

    new.currency_code := v_currency;
    new.exchange_rate := v_rate;
  end if;

  return new;
end;
$function$;

revoke all
on function public.prepare_invoice_journal_fx_header()
from public, anon, authenticated;


-- ============================================================
-- ACC-009 — SAFE COMPANY-SCOPED DISCOUNT MAPPING UPSERT
-- ============================================================

create or replace function public.ensure_commercial_discount_accounts()
returns void
language plpgsql
security definer
set search_path='public','pg_temp'
as $function$
declare
  v_uid uuid := public.legacy_data_user_id();
  v_company uuid := public.current_company_id();

  v_allowed uuid;
  v_received uuid;
begin
  if v_uid is null or v_company is null then
    raise exception
      'Authentication and active company are required.';
  end if;

  -- ----------------------------------------------------------
  -- Sales Discounts Allowed
  -- ----------------------------------------------------------

  select id
  into v_allowed
  from public.chart_of_accounts
  where company_id = v_company
    and code = '6600'
  order by created_at nulls last, id
  limit 1;

  if v_allowed is null then
    insert into public.chart_of_accounts(
      user_id,
      company_id,
      code,
      name,
      type,
      account_role,
      detail_type,
      is_group,
      normal_balance,
      allow_manual_entries,
      is_system_account,
      is_active,
      description
    )
    values(
      v_uid,
      v_company,
      '6600',
      'Sales Discounts Allowed',
      'expense',
      'general',
      'sales_discount_allowed',
      false,
      'debit',
      false,
      true,
      true,
      'Invoice-level commercial discounts allowed to customers'
    )
    returning id into v_allowed;
  end if;

  -- ----------------------------------------------------------
  -- Purchase Discounts Received
  -- ----------------------------------------------------------

  select id
  into v_received
  from public.chart_of_accounts
  where company_id = v_company
    and code = '4300'
  order by created_at nulls last, id
  limit 1;

  if v_received is null then
    insert into public.chart_of_accounts(
      user_id,
      company_id,
      code,
      name,
      type,
      account_role,
      detail_type,
      is_group,
      normal_balance,
      allow_manual_entries,
      is_system_account,
      is_active,
      description
    )
    values(
      v_uid,
      v_company,
      '4300',
      'Purchase Discounts Received',
      'revenue',
      'general',
      'purchase_discount_received',
      false,
      'credit',
      false,
      true,
      true,
      'Invoice-level commercial discounts received from suppliers'
    )
    returning id into v_received;
  end if;

  /*
   * Do not rely on ON CONFLICT(user_id,mapping_key).
   *
   * account_mappings is company-scoped in the current ERP.
   * Update the active company's mapping explicitly and insert
   * only when that mapping does not already exist.
   */

  update public.account_mappings
  set
    user_id = v_uid,
    account_id = v_allowed,
    updated_at = now()
  where company_id = v_company
    and mapping_key = 'sales_discount_allowed';

  if not found then
    insert into public.account_mappings(
      user_id,
      company_id,
      mapping_key,
      account_id
    )
    values(
      v_uid,
      v_company,
      'sales_discount_allowed',
      v_allowed
    );
  end if;

  update public.account_mappings
  set
    user_id = v_uid,
    account_id = v_received,
    updated_at = now()
  where company_id = v_company
    and mapping_key = 'purchase_discount_received';

  if not found then
    insert into public.account_mappings(
      user_id,
      company_id,
      mapping_key,
      account_id
    )
    values(
      v_uid,
      v_company,
      'purchase_discount_received',
      v_received
    );
  end if;

end;
$function$;

revoke all
on function public.ensure_commercial_discount_accounts()
from public, anon;

grant execute
on function public.ensure_commercial_discount_accounts()
to authenticated;


-- ============================================================
-- ACC-008 — DISCOUNT MAPPING LIFECYCLE TYPES
-- ============================================================

create or replace function public.protect_mapped_account_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  mapping_row record;
  expected_type text;
begin

  for mapping_row in
    select am.mapping_key
    from public.account_mappings am
    where am.account_id = old.id
  loop

    expected_type := case

      when mapping_row.mapping_key in (
        'cash',
        'bank',
        'accounts_receivable',
        'inventory',
        'input_vat'
      )
      then 'asset'

      when mapping_row.mapping_key in (
        'accounts_payable',
        'output_vat'
      )
      then 'liability'

      when mapping_row.mapping_key in (
        'share_capital',
        'retained_earnings'
      )
      then 'equity'

      when mapping_row.mapping_key in (
        'sales_revenue',
        'service_revenue',
        'sales',
        'purchase_discount_received',
        'fx_gain'
      )
      then 'revenue'

      when mapping_row.mapping_key in (
        'cogs',
        'cost_of_goods_sold',
        'salaries',
        'rent',
        'utilities',
        'transport_expense',
        'transport',
        'general_expense',
        'expense',
        'sales_discount_allowed',
        'fx_loss'
      )
      then 'expense'

      else null
    end;

    if new.user_id is distinct from old.user_id then
      raise exception
        using message = format(
          'Account %s is mapped as %s and cannot change owner.',
          old.code,
          mapping_row.mapping_key
        );
    end if;

    if not new.is_active then
      raise exception
        using
          message = format(
            'Account %s is mapped as %s and cannot be deactivated.',
            old.code,
            mapping_row.mapping_key
          ),
          hint =
            'Reassign the account mapping before deactivating this account.';
    end if;

    if new.is_group then
      raise exception
        using
          message = format(
            'Account %s is mapped as %s and must remain a posting account.',
            old.code,
            mapping_row.mapping_key
          ),
          hint =
            'Reassign the account mapping before converting this account to a group.';
    end if;

    if expected_type is null
       or new.type is distinct from expected_type then
      raise exception
        using
          message = format(
            'Account %s is mapped as %s and must remain type %s.',
            old.code,
            mapping_row.mapping_key,
            coalesce(
              expected_type,
              'defined by the accounting mapping'
            )
          ),
          hint =
            'Reassign the account mapping before changing this account type.';
    end if;

  end loop;

  return new;
end;
$function$;


-- ============================================================
-- ACC-007 — SYSTEM JOURNALS MAY USE PROTECTED SYSTEM ACCOUNTS
--
-- Keep allow_manual_entries=false meaningful for manual journals.
-- System-generated journals (Sales/Purchase/etc.) are allowed to
-- post against protected mapped system accounts.
-- ============================================================

do $migration$
declare
  v_oid oid;
  v_def text;
  v_old text;
  v_new text;
  v_fixed text;
begin

  select p.oid
  into v_oid
  from pg_proc p
  join pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'post_journal_entry'
    and pg_get_function_identity_arguments(p.oid) = 'p_entry_id uuid';

  if v_oid is null then
    raise exception
      'post_journal_entry(uuid) is missing.';
  end if;

  v_def := pg_get_functiondef(v_oid);

  /*
   * pg_get_functiondef() normalizes formatting, therefore ACC-007 must
   * not depend on an exact whitespace representation of the function.
   */
  v_old := 'OR coa.allow_manual_entries = false';

  v_new := $new$
OR (
        coa.allow_manual_entries = false
        AND EXISTS (
          SELECT 1
          FROM public.journal_entries je_manual_guard
          WHERE je_manual_guard.id = p_entry_id
            AND COALESCE(
              NULLIF(BTRIM(je_manual_guard.trans_type), ''),
              'Journal Entry'
            ) IN (
              'Journal Entry',
              'Manual Journal'
            )
        )
      )
$new$;

  /*
   * Idempotency:
   * If the replacement is already present, do nothing.
   */
  if position(v_new in v_def) > 0
     and position(v_old in v_def) = 0 then
    return;
  end if;

  v_fixed := replace(
    v_def,
    v_old,
    v_new
  );

  if v_fixed = v_def then
    raise exception
      'ACC-007 post_journal_entry patch pattern did not match current function.';
  end if;

  execute v_fixed;

end;
$migration$;


-- ============================================================
-- ASSERT FUNCTION DEFINITIONS AFTER MIGRATION
-- ============================================================

do $verify$
declare
  v_def text;
begin

  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'prepare_invoice_journal_fx_header'
  limit 1;

  if v_def is null
     or position(
       'substring(new.entry_no from 5)'
       in v_def
     ) = 0 then
    raise exception
      'ACC-004 migration verification failed.';
  end if;


  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'ensure_commercial_discount_accounts'
  limit 1;

  if v_def is null
     or position(
       'purchase_discount_received'
       in v_def
     ) = 0
     or position(
       'sales_discount_allowed'
       in v_def
     ) = 0 then
    raise exception
      'ACC-009 migration verification failed.';
  end if;


  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'protect_mapped_account_lifecycle'
  limit 1;

  if v_def is null
     or position(
       'purchase_discount_received'
       in v_def
     ) = 0
     or position(
       'sales_discount_allowed'
       in v_def
     ) = 0 then
    raise exception
      'ACC-008 migration verification failed.';
  end if;


  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'post_journal_entry'
    and pg_get_function_identity_arguments(p.oid) = 'p_entry_id uuid';

  if v_def is null
     or position(
       'je_manual_guard'
       in v_def
     ) = 0 then
    raise exception
      'ACC-007 migration verification failed.';
  end if;

end;
$verify$;


notify pgrst, 'reload schema';

commit;

