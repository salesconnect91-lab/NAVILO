begin;

-- ============================================================
-- ACC-006
--
-- Existing defect:
-- Purchase return obtains v_cost_rate from the original
-- purchase_order_lines.unit_cost.
--
-- That is wrong for foreign purchases because purchase inventory
-- was booked in company base currency using the invoice's locked
-- FX rate. It is also wrong where landed costs were capitalized.
--
-- Rule after this migration:
--
-- Direct purchase return:
--   reverse inventory using the original purchase's booked
--   BASE-CURRENCY unit valuation.
--
-- Do NOT use:
--   - current FX rate
--   - current item cost
--   - current inventory average cost
--
-- Consolidated-source purchases are deliberately not silently
-- forced through the direct-purchase formula.
-- ============================================================


create or replace function public.get_purchase_return_booked_unit_cost(
  p_purchase_line_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := public.legacy_data_user_id();
  v_company uuid := public.current_company_id();
  v_bu uuid := public.current_business_unit_id();

  v_order_id uuid;
  v_line_qty numeric;
  v_unit_cost numeric;
  v_line_source_value numeric;
  v_source_consolidated uuid;

  v_base_currency text;
  v_document_currency text;
  v_exchange_rate numeric;

  v_total_source_value numeric := 0;
  v_total_landed_source numeric := 0;
  v_line_landed_base numeric := 0;
  v_result numeric := 0;
begin

  if v_uid is null then
    raise exception
      'Authenticated user context is required for purchase return costing.';
  end if;

  if v_company is null then
    raise exception
      'Active company context is required for purchase return costing.';
  end if;

  if v_bu is null then
    raise exception
      'Active business unit context is required for purchase return costing.';
  end if;


  -- ----------------------------------------------------------
  -- Resolve original purchase line.
  -- ----------------------------------------------------------

  select
    pol.order_id,
    coalesce(pol.qty,0),
    coalesce(pol.unit_cost,0),
    coalesce(pol.qty,0) * coalesce(pol.unit_cost,0),
    pol.source_consolidated_purchase_invoice_id
  into
    v_order_id,
    v_line_qty,
    v_unit_cost,
    v_line_source_value,
    v_source_consolidated
  from public.purchase_order_lines pol
  where pol.id = p_purchase_line_id
    and pol.user_id = v_uid
    and pol.company_id = v_company
    and pol.business_unit_id = v_bu;

  if v_order_id is null then
    raise exception
      'Original purchase line % was not found in active tenant/business unit.',
      p_purchase_line_id;
  end if;


  -- ----------------------------------------------------------
  -- Consolidated purchase has its own posting/cost lifecycle.
  -- Never silently apply a direct-purchase valuation formula.
  -- ----------------------------------------------------------

  if v_source_consolidated is not null then
    raise exception
      'Purchase return line % originated from a consolidated purchase invoice; consolidated booked-cost reversal requires its own valuation path.',
      p_purchase_line_id;
  end if;


  -- ----------------------------------------------------------
  -- Original POSTED document currency snapshot.
  -- ----------------------------------------------------------

  select
    c.base_currency_code,
    coalesce(
      nullif(po.currency_code,''),
      c.base_currency_code
    ),
    case
      when coalesce(
             nullif(po.currency_code,''),
             c.base_currency_code
           ) = c.base_currency_code
      then 1
      else po.exchange_rate
    end
  into
    v_base_currency,
    v_document_currency,
    v_exchange_rate
  from public.purchase_orders po
  join public.companies c
    on c.id = po.company_id
  where po.id = v_order_id
    and po.user_id = v_uid
    and po.company_id = v_company
    and po.business_unit_id = v_bu
    and po.status = 'posted';

  if v_base_currency is null then
    raise exception
      'Original posted purchase invoice % was not found.',
      v_order_id;
  end if;

  if v_exchange_rate is null
     or v_exchange_rate <= 0 then
    raise exception
      'Original purchase invoice % has invalid locked exchange rate.',
      v_order_id;
  end if;


  -- ----------------------------------------------------------
  -- Total item value in DOCUMENT currency.
  -- This is the denominator used to allocate landed charges.
  -- ----------------------------------------------------------

  select
    coalesce(
      sum(
        coalesce(pol.qty,0)
        * coalesce(pol.unit_cost,0)
      ),
      0
    )
  into v_total_source_value
  from public.purchase_order_lines pol
  where pol.order_id = v_order_id
    and pol.user_id = v_uid
    and pol.company_id = v_company
    and pol.business_unit_id = v_bu;


  -- ----------------------------------------------------------
  -- Determine landed-cost charges from the original purchase.
  --
  -- This mirrors NAVILO's purchase inventory costing rule:
  --   other => expense
  --   configured purchase_treatment respected
  --   otherwise normal purchase charges default landed_cost
  -- ----------------------------------------------------------

  with purchase_row as (
    select po.*
    from public.purchase_orders po
    where po.id = v_order_id
      and po.user_id = v_uid
      and po.company_id = v_company
      and po.business_unit_id = v_bu
  ),

  direct_charges(charge_key, amount) as (

    select
      'loading',
      coalesce(po.loading_charge,0)
    from purchase_row po

    union all

    select
      'unloading',
      coalesce(po.unloading_charge,0)
    from purchase_row po

    union all

    select
      'cutting',
      coalesce(po.cutting_charge,0)
    from purchase_row po

    union all

    select
      'transport',
      coalesce(po.transport_charge,0)
    from purchase_row po

    union all

    select
      'labour',
      coalesce(po.labour_charge,0)
    from purchase_row po

    union all

    select
      'handling',
      coalesce(po.handling_charge,0)
    from purchase_row po

    union all

    select
      'other',
      coalesce(po.other_charge,0)
    from purchase_row po
  ),

  classified as (
    select
      dc.charge_key,
      dc.amount,

      case
        when dc.charge_key = 'other'
        then 'expense'

        else coalesce(
          (
            select cm.purchase_treatment
            from public.charge_master cm
            where cm.company_id = v_company
              and cm.charge_key = dc.charge_key
              and cm.applies_to in ('purchase','both')
              and cm.is_active
            order by cm.created_at desc nulls last
            limit 1
          ),
          'landed_cost'
        )
      end as treatment

    from direct_charges dc
  )

  select
    coalesce(
      sum(
        case
          when treatment = 'landed_cost'
          then amount
          else 0
        end
      ),
      0
    )
  into v_total_landed_source
  from classified;


  -- ----------------------------------------------------------
  -- Allocate landed cost proportionally to this line.
  -- Convert both merchandise and landed cost using ORIGINAL
  -- locked invoice rate.
  -- ----------------------------------------------------------

  if v_total_source_value > 0
     and v_line_source_value > 0
     and v_line_qty > 0 then

    v_line_landed_base :=
        (v_total_landed_source * v_exchange_rate)
        *
        (v_line_source_value / v_total_source_value);

  else
    v_line_landed_base := 0;
  end if;


  v_result :=
      (v_unit_cost * v_exchange_rate)
      +
      case
        when v_line_qty > 0
        then v_line_landed_base / v_line_qty
        else 0
      end;


  if v_result < 0 then
    raise exception
      'Calculated purchase return booked unit cost cannot be negative.';
  end if;

  return round(coalesce(v_result,0),6);

end;
$function$;


revoke all
on function public.get_purchase_return_booked_unit_cost(uuid)
from public, anon, authenticated;

grant execute
on function public.get_purchase_return_booked_unit_cost(uuid)
to service_role;


-- ============================================================
-- PATCH FINAL CANONICAL RETURN FUNCTION
--
-- Existing purchase-return statement:
--
--   if l.id is not null then
--     v_cost_rate:=coalesce(l.cost_rate,0);
--   end if;
--
-- l.cost_rate currently comes from purchase_order_lines.unit_cost.
--
-- Replace only that assignment.
-- ============================================================

do $patch$
declare
  v_oid oid;
  v_def text;
  v_new_def text;

  v_old text :=
    'if l.id is not null then v_cost_rate:=coalesce(l.cost_rate,0); end if;';

  v_new text :=
    'if l.id is not null then v_cost_rate:=public.get_purchase_return_booked_unit_cost(l.id); end if;';
begin

  select p.oid
  into v_oid
  from pg_proc p
  join pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'create_and_post_return_note_internal'
    and pg_get_function_identity_arguments(p.oid)
      =
      'p_note_type text, p_order_id uuid, p_note_date date, p_reason text, p_lines jsonb';

  if v_oid is null then
    raise exception
      'ACC-006: create_and_post_return_note_internal(...) not found.';
  end if;


  v_def := pg_get_functiondef(v_oid);


  -- Idempotent replay.
  if position(v_new in v_def) > 0 then
    return;
  end if;


  if position(v_old in v_def) = 0 then
    raise exception
      'ACC-006 patch pattern did not match current canonical return function.';
  end if;


  v_new_def :=
    replace(
      v_def,
      v_old,
      v_new
    );


  if v_new_def = v_def then
    raise exception
      'ACC-006 failed to alter canonical return function.';
  end if;


  execute v_new_def;

end;
$patch$;


-- Preserve internal-function privilege boundary.

revoke all
on function public.create_and_post_return_note_internal(
  text,
  uuid,
  date,
  text,
  jsonb
)
from public, anon, authenticated;

grant execute
on function public.create_and_post_return_note_internal(
  text,
  uuid,
  date,
  text,
  jsonb
)
to service_role;


-- ============================================================
-- INSTALLATION ASSERTION
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
    and p.proname = 'create_and_post_return_note_internal'
    and pg_get_function_identity_arguments(p.oid)
      =
      'p_note_type text, p_order_id uuid, p_note_date date, p_reason text, p_lines jsonb';

  if v_def is null then
    raise exception
      'ACC-006 verification: canonical return function missing.';
  end if;

  if position(
       'get_purchase_return_booked_unit_cost(l.id)'
       in v_def
     ) = 0 then

    raise exception
      'ACC-006 verification: booked base cost helper is not installed in return posting.';

  end if;

end;
$verify$;


notify pgrst, 'reload schema';

commit;
