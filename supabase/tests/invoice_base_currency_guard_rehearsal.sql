-- Local synthetic rehearsal only; no production or posted documents are changed.
begin;
do $$
declare
  v_pkr uuid; v_other_pkr uuid; v_eur uuid; v_code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
  v_table text; v_rejected boolean; v_currency text; v_rate numeric; v_legacy_id integer;
begin
  insert into public.companies(name,code,status)
  values('PKR invoice rehearsal','PB'||v_code,'active') returning id into v_pkr;
  insert into public.companies(name,code,status)
  values('Second PKR invoice rehearsal','PC'||v_code,'active') returning id into v_other_pkr;
  insert into public.companies(name,code,status,base_currency_code)
  values('EUR invoice rehearsal','EB'||v_code,'active','EUR') returning id into v_eur;
  insert into public.company_exchange_rates
    (company_id,foreign_currency_code,base_currency_code,effective_on,rate,source)
  values(v_eur,'USD','EUR',current_date,0.91,'rehearsal');

  foreach v_table in array array['sales_orders','purchase_orders',
                                  'consolidated_sales_invoices','consolidated_purchase_invoices'] loop
    execute format('create temporary table %I (id integer generated always as identity,
      company_id uuid, status text, currency_code text, exchange_rate numeric)',v_table);
    execute format('create trigger zz_guard_invoice_base_currency before insert or update of
      company_id,currency_code,exchange_rate,status on pg_temp.%I
      for each row execute function public.guard_document_base_currency_snapshot()',v_table);
    execute format('insert into pg_temp.%I(company_id,status) values ($1,''draft''),($2,''draft'')',v_table)
      using v_pkr,v_eur;
    execute format('select currency_code,exchange_rate from pg_temp.%I where id=1',v_table)
      into v_currency,v_rate;
    if v_currency<>'PKR' or v_rate<>1 then raise exception '% did not snapshot PKR base',v_table; end if;
    execute format('select currency_code,exchange_rate from pg_temp.%I where id=2',v_table)
      into v_currency,v_rate;
    if v_currency<>'EUR' or v_rate<>1 then raise exception '% did not snapshot EUR base',v_table; end if;

    v_rejected:=false;
    begin
      execute format('insert into pg_temp.%I(company_id,status,currency_code)
        values ($1,''draft'',''USD'')',v_table) using v_eur;
    exception when raise_exception then v_rejected:=true;
    end;
    if not v_rejected then raise exception '% accepted foreign invoice without conversion',v_table; end if;
    v_rejected:=false;
    begin
      execute format('update pg_temp.%I set exchange_rate=0.91 where id=2',v_table);
    exception when raise_exception then v_rejected:=true;
    end;
    if not v_rejected then raise exception '% accepted non-base rate',v_table; end if;

    execute format('update pg_temp.%I set status=''posted'' where id=1',v_table);
    v_rejected:=false;
    begin
      execute format('update pg_temp.%I set currency_code=''EUR'' where id=1',v_table);
    exception when raise_exception then v_rejected:=true;
    end;
    if not v_rejected then raise exception '% changed posted currency snapshot',v_table; end if;

    v_rejected:=false;
    begin
      -- Both companies use independent ledgers; changing the company after
      -- posting must fail even if their base currencies happen to match.
      execute format('update pg_temp.%I set company_id=$1 where id=1',v_table)
        using v_other_pkr;
    exception when raise_exception then v_rejected:=true;
    end;
    if not v_rejected then raise exception '% moved a posted invoice to another company',v_table; end if;

    -- A legacy posted row whose snapshot was null before this migration must
    -- remain null on later updates; the migration does not backfill it.
    execute format('alter table pg_temp.%I disable trigger zz_guard_invoice_base_currency',v_table);
    execute format('insert into pg_temp.%I(company_id,status) values ($1,''posted'') returning id',v_table)
      into v_legacy_id using v_pkr;
    execute format('alter table pg_temp.%I enable trigger zz_guard_invoice_base_currency',v_table);
    execute format('update pg_temp.%I set status=''posted'' where id=$1',v_table) using v_legacy_id;
    execute format('select currency_code,exchange_rate from pg_temp.%I where id=$1',v_table)
      into v_currency,v_rate using v_legacy_id;
    if v_currency is not null or v_rate is not null then
      raise exception '% rewrote legacy posted history',v_table;
    end if;
    execute format('drop table pg_temp.%I',v_table);
  end loop;
  raise notice 'PASS: four invoice types snapshot company base; foreign posting blocked; posted company and history unchanged';
end $$;
rollback;
