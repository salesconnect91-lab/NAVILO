begin;

-- The shared snapshot trigger is attached to document tables whose date columns
-- are not identical. Resolve the accounting date without referencing a record
-- field that does not exist on a given trigger row type.

create or replace function public.guard_document_base_currency_snapshot()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_base text;
  v_document_date date;
  v_rate numeric;
  v_row jsonb;
begin
  if tg_op='UPDATE' and old.status='posted' then
    if new.company_id is distinct from old.company_id
       or new.currency_code is distinct from old.currency_code
       or new.exchange_rate is distinct from old.exchange_rate then
      raise exception
        'Posted invoice company and currency snapshot are immutable';
    end if;
    return new;
  end if;

  if new.company_id is null then
    raise exception 'Invoice company is required.';
  end if;

  select c.base_currency_code
    into v_base
  from public.companies c
  where c.id=new.company_id;

  if v_base is null then
    raise exception 'Invoice company has no base currency';
  end if;

  -- Convert the trigger row to jsonb first so a missing table-specific date
  -- column yields NULL instead of a PL/pgSQL "record has no field" failure.
  v_row:=to_jsonb(new);

  if tg_table_name in ('sales_orders','purchase_orders') then
    v_document_date:=coalesce(
      nullif(v_row->>'order_date','')::date,
      nullif(v_row->>'invoice_date','')::date,
      current_date
    );
  elsif tg_table_name in ('consolidated_sales_invoices','consolidated_purchase_invoices') then
    v_document_date:=coalesce(
      nullif(v_row->>'invoice_date','')::date,
      nullif(v_row->>'order_date','')::date,
      current_date
    );
  else
    raise exception
      'Unsupported invoice table for currency snapshot: %',
      tg_table_name;
  end if;

  new.currency_code:=coalesce(nullif(btrim(new.currency_code),''),v_base);

  if new.currency_code=v_base then
    new.exchange_rate:=1;
    return new;
  end if;

  v_rate:=public.company_exchange_rate_on(
    new.company_id,
    new.currency_code,
    v_document_date
  );

  if v_rate is null or v_rate<=0 then
    raise exception
      'No company exchange rate for % on %',
      new.currency_code,
      v_document_date;
  end if;

  new.exchange_rate:=v_rate;
  return new;
end;
$$;

revoke all on function public.guard_document_base_currency_snapshot()
  from public,anon,authenticated;

commit;
