-- Permit each company to choose posting accounts for realized FX gains and losses.
-- No existing company/account/posted transaction is modified or auto-mapped.
create or replace function public.validate_account_mapping()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  mapped_account public.chart_of_accounts%rowtype;
  expected_type text;
begin
  new.mapping_key := lower(trim(new.mapping_key));

  if tg_op = 'INSERT' and exists (
    select 1 from public.account_mappings am
    where am.company_id = new.company_id and am.mapping_key = new.mapping_key
  ) then
    new.updated_at := now();
    return new;
  end if;

  expected_type := case
    when new.mapping_key in ('cash','bank','accounts_receivable','inventory','input_vat') then 'asset'
    when new.mapping_key in ('accounts_payable','output_vat') then 'liability'
    when new.mapping_key in ('share_capital','retained_earnings') then 'equity'
    when new.mapping_key in ('sales_revenue','service_revenue','sales','purchase_discount_received','fx_gain') then 'revenue'
    when new.mapping_key in (
      'cogs','cost_of_goods_sold','salaries','salary_expense','rent','rent_expense',
      'utilities','utilities_expense','transport_expense','transport',
      'general_expense','expense','sales_discount_allowed','fx_loss'
    ) then 'expense'
    else null
  end;

  if expected_type is null then
    raise exception using
      message = format('Unsupported accounting mapping key: %s',new.mapping_key),
      hint = 'Use a mapping key defined by the ERP accounting engine.';
  end if;

  select coa.* into mapped_account
  from public.chart_of_accounts coa
  where coa.id = new.account_id
    and coa.company_id = new.company_id;

  if not found then
    raise exception 'Mapped account must belong to the same company.';
  end if;
  if mapped_account.is_group then
    raise exception 'A group/header account cannot be used as an accounting mapping.';
  end if;
  if not mapped_account.is_active then
    raise exception 'An inactive account cannot be used as an accounting mapping.';
  end if;
  if mapped_account.type is distinct from expected_type then
    raise exception 'Mapping % requires an % account, not %.',
      new.mapping_key,expected_type,mapped_account.type;
  end if;

  new.updated_at := now();
  return new;
end;
$function$;

-- Keep a valid account mapping valid for its entire lifecycle.
--
-- Mapping rows are already validated when written. This complementary trigger
-- prevents a linked COA account from later becoming inactive, becoming a group,
-- changing owner, or changing to an incompatible accounting type.

create or replace function public.protect_mapped_account_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
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
        'cash', 'bank', 'accounts_receivable', 'inventory', 'input_vat'
      ) then 'asset'
      when mapping_row.mapping_key in (
        'accounts_payable', 'output_vat'
      ) then 'liability'
      when mapping_row.mapping_key in (
        'share_capital', 'retained_earnings'
      ) then 'equity'
      when mapping_row.mapping_key in (
        'sales_revenue', 'service_revenue', 'sales', 'fx_gain'
      ) then 'revenue'
      when mapping_row.mapping_key in (
        'cogs', 'cost_of_goods_sold', 'salaries', 'rent', 'utilities',
        'transport_expense', 'transport', 'general_expense', 'expense', 'fx_loss'
      ) then 'expense'
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
          hint = 'Reassign the account mapping before deactivating this account.';
    end if;

    if new.is_group then
      raise exception
        using
          message = format(
            'Account %s is mapped as %s and must remain a posting account.',
            old.code,
            mapping_row.mapping_key
          ),
          hint = 'Reassign the account mapping before converting this account to a group.';
    end if;

    if expected_type is null or new.type is distinct from expected_type then
      raise exception
        using
          message = format(
            'Account %s is mapped as %s and must remain type %s.',
            old.code,
            mapping_row.mapping_key,
            coalesce(expected_type, 'defined by the accounting mapping')
          ),
          hint = 'Reassign the account mapping before changing this account type.';
    end if;
  end loop;

  return new;
end;
$$;

