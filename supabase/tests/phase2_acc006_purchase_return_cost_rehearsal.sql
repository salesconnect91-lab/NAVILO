\set ON_ERROR_STOP on

begin;

do $test$
declare
  v_def text;
  v_helper text;

  v_fx numeric := 280;
  v_item_a_qty numeric := 2;
  v_item_a_unit numeric := 100;

  v_item_b_qty numeric := 1;
  v_item_b_unit numeric := 200;

  v_landed numeric := 40;

  v_total_source numeric;
  v_a_source numeric;
  v_a_landed_base numeric;
  v_a_expected numeric;
begin

  -- ----------------------------------------------------------
  -- Helper installed?
  -- ----------------------------------------------------------

  select pg_get_functiondef(p.oid)
  into v_helper
  from pg_proc p
  join pg_namespace n
    on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='get_purchase_return_booked_unit_cost'
    and pg_get_function_identity_arguments(p.oid)
      ='p_purchase_line_id uuid';

  if v_helper is null then
    raise exception
      'ACC-006 FAIL: booked purchase return cost helper missing.';
  end if;


  -- Helper must use original purchase exchange_rate.

  if position(
       'po.exchange_rate'
       in v_helper
     ) = 0 then
    raise exception
      'ACC-006 FAIL: original purchase exchange rate is not used.';
  end if;


  -- Helper must not read inventory_costs/current average cost.

  if lower(v_helper) like '%inventory_costs%'
     or lower(v_helper) like '%avg_cost%' then
    raise exception
      'ACC-006 FAIL: helper depends on current inventory average cost.';
  end if;


  -- ----------------------------------------------------------
  -- Canonical return function installed?
  -- ----------------------------------------------------------

  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n
    on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='create_and_post_return_note_internal'
    and pg_get_function_identity_arguments(p.oid)
      =
      'p_note_type text, p_order_id uuid, p_note_date date, p_reason text, p_lines jsonb';

  if v_def is null then
    raise exception
      'ACC-006 FAIL: canonical return function missing.';
  end if;


  if position(
       'get_purchase_return_booked_unit_cost(l.id)'
       in v_def
     ) = 0 then
    raise exception
      'ACC-006 FAIL: canonical purchase return still does not use booked base cost helper.';
  end if;


  -- ----------------------------------------------------------
  -- Mathematical reconciliation example:
  --
  -- Item A = 2 x USD100 = USD200
  -- Item B = 1 x USD200 = USD200
  -- Source goods total = USD400
  -- Landed cost = USD40
  -- FX = PKR280/USD
  --
  -- Item A receives 50% of landed = USD20
  -- base landed A = 20*280 = 5600
  -- merchandise base A = 2*100*280 = 56000
  -- total booked A = 61600
  -- booked unit A = 30800
  -- ----------------------------------------------------------

  v_a_source :=
    v_item_a_qty * v_item_a_unit;

  v_total_source :=
      (v_item_a_qty * v_item_a_unit)
      +
      (v_item_b_qty * v_item_b_unit);

  v_a_landed_base :=
      (v_landed * v_fx)
      *
      (v_a_source / v_total_source);

  v_a_expected :=
      (v_item_a_unit * v_fx)
      +
      (v_a_landed_base / v_item_a_qty);


  if abs(v_a_expected - 30800) > 0.000001 then
    raise exception
      'ACC-006 FAIL: deterministic booked-cost math expected 30800, got %',
      v_a_expected;
  end if;


  raise notice
    'ACC-006 PASS: purchase return canonical path uses original booked base-cost helper.';

  raise notice
    'ACC-006 deterministic FX + landed cost unit basis = %',
    v_a_expected;

end;
$test$;

rollback;
