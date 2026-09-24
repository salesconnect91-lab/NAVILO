-- Isolated local database only. Synthetic company and documents roll back.
begin;
do $$
declare
  v_company uuid;
  v_user uuid := gen_random_uuid();
  v_code text := 'T' || substr(replace(gen_random_uuid()::text,'-',''),1,12);
  v_table text;
  v_date_column text;
  v_non_tax_type text;
  v_rejected boolean;
begin
  insert into auth.users(id,role,email,created_at,updated_at)
  values (v_user,'authenticated','tax-transition-'||v_code||'@navilo.test',now(),now());
  insert into public.companies(name,code,status)
  values ('Tax transition rehearsal',v_code,'trial') returning id into v_company;
  insert into public.company_tax_events(company_id,effective_from,tax_mode)
  values (v_company,current_date,'non_tax');
  insert into public.company_tax_events(company_id,effective_from,tax_mode,authority_code)
  values (v_company,current_date+1,'tax_registered','REHEARSAL');
  insert into public.tax_rates(user_id,company_id,name,rate,applies_to,is_fixed,is_active,effective_from)
  values (v_user,v_company,'Tax rehearsal '||v_code,17.5,'both',true,true,current_date+1);

  if (select e.tax_mode from public.company_tax_events e where e.company_id=v_company
      and e.effective_from<=current_date order by e.effective_from desc limit 1)<>'non_tax' then
    raise exception 'Historical mode was overwritten by later event';
  end if;

  foreach v_table in array array['sales_orders','purchase_orders',
                                 'consolidated_sales_invoices','consolidated_purchase_invoices'] loop
    v_date_column:=case when v_table in ('sales_orders','purchase_orders') then 'order_date' else 'invoice_date' end;
    v_non_tax_type:=case when v_table like '%purchase%' then 'Purchase Invoice' else 'Sale Invoice' end;
    -- A temporary header exercises the production trigger without requiring unrelated
    -- customer, warehouse, accounting, or authenticated user fixtures.
    execute format('create temporary table %I (id integer generated always as identity,
      company_id uuid, invoice_type text, tax_percent numeric, status text, %I date)',v_table,v_date_column);
    execute format('create trigger tax_rehearsal before insert or update on pg_temp.%I
      for each row execute function public.guard_document_tax_transition()',v_table);
    execute format('insert into pg_temp.%I(company_id,invoice_type,tax_percent,status,%I)
      values ($1,$2,0,''draft'',current_date)',v_table,v_date_column)
      using v_company,v_non_tax_type;

    v_rejected:=false;
    begin
      execute format('insert into pg_temp.%I(company_id,invoice_type,tax_percent,status,%I)
        values ($1,''Tax Invoice'',0,''draft'',current_date)',v_table,v_date_column)
        using v_company;
    exception when raise_exception then v_rejected:=true;
    end;
    if not v_rejected then raise exception '% accepted tax invoice before effective date',v_table; end if;

    execute format('insert into pg_temp.%I(company_id,invoice_type,tax_percent,status,%I)
      values ($1,''Tax Invoice'',17.5,''draft'',current_date+1)',v_table,v_date_column)
      using v_company;
    execute format('update pg_temp.%I set status=''posted'' where id=1',v_table);
    v_rejected:=false;
    begin
      execute format('update pg_temp.%I set %I=current_date+1 where id=1',v_table,v_date_column);
    exception when raise_exception then v_rejected:=true;
    end;
    if not v_rejected then raise exception '% changed posted historical date',v_table; end if;
    v_rejected:=false;
    begin
      execute format('update pg_temp.%I set invoice_type=''Tax Invoice'' where id=1',v_table);
    exception when raise_exception then v_rejected:=true;
    end;
    if not v_rejected then raise exception '% changed posted historical type',v_table; end if;
    v_rejected:=false;
    begin
      execute format('update pg_temp.%I set tax_percent=12 where id=1',v_table);
    exception when raise_exception then v_rejected:=true;
    end;
    if not v_rejected then raise exception '% changed posted historical rate',v_table; end if;
    execute format('drop table pg_temp.%I',v_table);
  end loop;
  raise notice 'PASS: four document types preserve non-tax history and accept later tax mode';
end $$;
rollback;
