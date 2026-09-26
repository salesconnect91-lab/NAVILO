\set ON_ERROR_STOP on

begin;

do $test$
declare
  v_def text;
  v_count integer;
begin

  raise notice 'PHASE2-A: checking ACC-004 FX purchase lookup...';

  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'prepare_invoice_journal_fx_header'
  limit 1;

  if v_def is null then
    raise exception
      'ACC-004 FAIL: prepare_invoice_journal_fx_header missing';
  end if;

  if position(
       'substring(new.entry_no from 5)'
       in v_def
     ) = 0 then
    raise exception
      'ACC-004 FAIL: PUR- prefix normalization missing';
  end if;

  if position(
       'p.order_no = v_source_entry_no'
       in v_def
     ) = 0 then
    raise exception
      'ACC-004 FAIL: normalized purchase lookup missing';
  end if;

  raise notice 'ACC-004 PASS';


  raise notice 'PHASE2-A: checking ACC-009 discount bootstrap...';

  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'ensure_commercial_discount_accounts'
  limit 1;

  if v_def is null then
    raise exception
      'ACC-009 FAIL: ensure_commercial_discount_accounts missing';
  end if;

  if position(
       'on conflict (user_id, mapping_key)'
       in lower(v_def)
     ) > 0 then
    raise exception
      'ACC-009 FAIL: invalid legacy ON CONFLICT still present';
  end if;

  if position(
       'sales_discount_allowed'
       in v_def
     ) = 0
     or position(
       'purchase_discount_received'
       in v_def
     ) = 0 then
    raise exception
      'ACC-009 FAIL: discount mappings missing';
  end if;

  raise notice 'ACC-009 PASS';


  raise notice 'PHASE2-A: checking ACC-008 lifecycle mapping types...';

  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'protect_mapped_account_lifecycle'
  limit 1;

  if v_def is null then
    raise exception
      'ACC-008 FAIL: lifecycle function missing';
  end if;

  if position(
       'sales_discount_allowed'
       in v_def
     ) = 0 then
    raise exception
      'ACC-008 FAIL: sales discount lifecycle type missing';
  end if;

  if position(
       'purchase_discount_received'
       in v_def
     ) = 0 then
    raise exception
      'ACC-008 FAIL: purchase discount lifecycle type missing';
  end if;

  raise notice 'ACC-008 PASS';


  raise notice 'PHASE2-A: checking ACC-007 system-account posting guard...';

  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'post_journal_entry'
    and pg_get_function_identity_arguments(p.oid) = 'p_entry_id uuid';

  if v_def is null then
    raise exception
      'ACC-007 FAIL: post_journal_entry missing';
  end if;

  if position(
       'je_manual_guard'
       in v_def
     ) = 0 then
    raise exception
      'ACC-007 FAIL: manual/system journal distinction missing';
  end if;

  if position(
       'coa.allow_manual_entries = false'
       in v_def
     ) = 0 then
    raise exception
      'ACC-007 FAIL: manual-entry protection was removed entirely';
  end if;

  raise notice 'ACC-007 PASS';


  select count(*)
  into v_count
  from pg_proc p
  join pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'prepare_invoice_journal_fx_header',
      'ensure_commercial_discount_accounts',
      'protect_mapped_account_lifecycle',
      'post_journal_entry'
    );

  if v_count < 4 then
    raise exception
      'PHASE2-A FAIL: required accounting functions missing';
  end if;


  raise notice '==============================================';
  raise notice 'NAVILO PHASE2 ACCOUNTING CORE BATCH A: PASS';
  raise notice 'ACC-004 PASS';
  raise notice 'ACC-007 PASS';
  raise notice 'ACC-008 PASS';
  raise notice 'ACC-009 PASS';
  raise notice '==============================================';

end;
$test$;

rollback;
