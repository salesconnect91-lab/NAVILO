\set ON_ERROR_STOP on
begin;

do $$
begin
  if to_regprocedure(
    'public.assert_source_operating_location(uuid,uuid,uuid)'
  ) is null then
    raise exception 'ACC-005 FAIL: location assertion function missing.';
  end if;

  if not exists(
    select 1 from pg_trigger
    where tgname='zz_guard_sales_order_posting_location'
      and not tgisinternal
  ) then
    raise exception 'ACC-005 FAIL: sales posting guard missing.';
  end if;

  if not exists(
    select 1 from pg_trigger
    where tgname='zz_guard_purchase_order_posting_location'
      and not tgisinternal
  ) then
    raise exception 'ACC-005 FAIL: purchase posting guard missing.';
  end if;

  raise notice 'ACC-005 PASS: sales/purchase source posting location guards installed.';
end $$;

rollback;
