-- Local synthetic rehearsal for the current multi-currency invoice contract.
-- Replaces the old base-only expectation without changing historical test files.
begin;
do $$
declare
  v_pkr uuid; v_eur uuid; v_code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
  v_table text; v_rejected boolean; v_currency text; v_rate numeric; v_legacy_id integer;
begin
  insert into public.companies(name,code,status)
  values('PKR invoice FX rehearsal','PX'||v_code,'active') returning id into v_pkr;

  insert into public.companies(name,code,status,base_currency_code)
  values('EUR invoice FX rehearsal','EX'||v_code,'active','EUR') returning id into v_eur;

  insert into public.company_exchange_rates
    (company_id,foreign_currency_code,base_currency_code,effective_on,rate,source)
  values(v_eur,'USD','EUR',current_date,0.91,'rehearsal');

  -- The production helper intentionally requires active tenant access. This
  -- synthetic trigger rehearsal runs as direct local SQL, so emulate the
  -- exact effective-rate lookup in a temp shadow helper only for this
  -- transaction. Production function remains unchanged.
  create temporary table fx_rehearsal_context(company_id uuid primary key);
  insert into fx_rehearsal_context values(v_eur);
  execute $sql$
    create or replace function pg_temp.company_exchange_rate_on_local(
      p_company_id uuid,p_currency_code text,p_on date
    ) returns numeric language sql stable as $
      select case when p_currency_code=c.base_currency_code then 1::numeric
        else (select r.rate from public.company_exchange_rates r
              where r.company_id=c.id
                and r.base_currency_code=c.base_currency_code
                and r.foreign_currency_code=p_currency_code
                and r.effective_on<=p_on
              order by r.effective_on desc,r.recorded_at desc,r.id desc limit 1)
        end
      from public.companies c where c.id=p_company_id
    $
  $sql$;

  foreach v_table in array array[
    'sales_orders','purchase_orders',
    'consolidated_sales_invoices','consolidated_purchase_invoices'
  ] loop
    execute format('create temporary table %I (
      id integer generated always as identity,
      company_id uuid,
      status text,
      currency_code text,
      exchange_rate numeric,
      order_date date,
      invoice_date date
    )',v_table);

    execute format('create trigger zz_guard_invoice_base_currency
      before insert or update of company_id,currency_code,exchange_rate,status
      on pg_temp.%I for each row
      execute function public.guard_document_base_currency_snapshot()',v_table);

    execute format('insert into pg_temp.%I(company_id,status)
      values ($1,''draft''),($2,''draft'')',v_table) using v_pkr,v_eur;

    execute format('select currency_code,exchange_rate from pg_temp.%I where id=1',v_table)
      into v_currency,v_rate;
    if v_currency<>'PKR' or v_rate<>1 then
      raise exception '% did not snapshot PKR base',v_table;
    end if;

    execute format('select currency_code,exchange_rate from pg_temp.%I where id=2',v_table)
      into v_currency,v_rate;
    if v_currency<>'EUR' or v_rate<>1 then
      raise exception '% did not snapshot EUR base',v_table;
    end if;

    -- Current contract: foreign currency is accepted only when an effective
    -- company rate exists; the supplied stale/manual rate is replaced by the
    -- effective locked rate.
    execute format('insert into pg_temp.%I(company_id,status,currency_code,exchange_rate)
      values ($1,''draft'',''USD'',123)',v_table) using v_eur;

    execute format('select currency_code,exchange_rate from pg_temp.%I where id=3',v_table)
      into v_currency,v_rate;
    if v_currency<>'USD' or v_rate<>0.91 then
      raise exception '% did not lock effective USD/EUR rate',v_table;
    end if;

    v_rejected:=false;
    begin
      execute format('insert into pg_temp.%I(company_id,status,currency_code)
        values ($1,''draft'',''GBP'')',v_table) using v_eur;
    exception when raise_exception then v_rejected:=true;
    end;
    if not v_rejected then
      raise exception '% accepted foreign currency without effective company rate',v_table;
    end if;

    execute format('update pg_temp.%I set status=''posted'' where id=3',v_table);

    v_rejected:=false;
    begin
      execute format('update pg_temp.%I set exchange_rate=0.95 where id=3',v_table);
    exception when raise_exception then v_rejected:=true;
    end;
    if not v_rejected then
      raise exception '% changed posted foreign exchange rate',v_table;
    end if;

    v_rejected:=false;
    begin
      execute format('update pg_temp.%I set currency_code=''EUR'' where id=3',v_table);
    exception when raise_exception then v_rejected:=true;
    end;
    if not v_rejected then
      raise exception '% changed posted foreign currency',v_table;
    end if;

    -- Preserve historical posted rows whose snapshot predates currency support.
    execute format('alter table pg_temp.%I disable trigger zz_guard_invoice_base_currency',v_table);
    execute format('insert into pg_temp.%I(company_id,status)
      values ($1,''posted'') returning id',v_table) into v_legacy_id using v_pkr;
    execute format('alter table pg_temp.%I enable trigger zz_guard_invoice_base_currency',v_table);

    execute format('update pg_temp.%I set status=''posted'' where id=$1',v_table) using v_legacy_id;
    execute format('select currency_code,exchange_rate from pg_temp.%I where id=$1',v_table)
      into v_currency,v_rate using v_legacy_id;
    if v_currency is not null or v_rate is not null then
      raise exception '% rewrote legacy posted history',v_table;
    end if;

    execute format('drop table pg_temp.%I',v_table);
  end loop;

  raise notice 'PASS: four invoice types lock base/foreign currency snapshots, require effective FX rates and preserve posted history';
end $$;
rollback;
