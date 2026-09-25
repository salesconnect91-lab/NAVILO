-- A posted invoice's company determines its base currency and its ledgers.
-- Preserve historical null currency snapshots, while refusing a move to
-- another company even when the stored currency/rate happen to match.
create or replace function public.guard_document_base_currency_snapshot()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_base text;
begin
  if tg_op='UPDATE' and old.status='posted' then
    if new.company_id is distinct from old.company_id or
       new.currency_code is distinct from old.currency_code or
       new.exchange_rate is distinct from old.exchange_rate then
      raise exception 'Posted invoice company and currency snapshot are immutable';
    end if;
    return new;
  end if;

  select base_currency_code into v_base from public.companies where id=new.company_id;
  if v_base is null then raise exception 'Invoice company has no base currency'; end if;
  if new.currency_code is not null and new.currency_code<>v_base then
    raise exception 'Foreign sales/purchase invoice posting requires base-currency inventory, payment and ledger conversion';
  end if;
  if new.exchange_rate is not null and new.exchange_rate<>1::numeric then
    raise exception 'Base-currency invoice exchange rate must equal one';
  end if;
  new.currency_code:=v_base;
  new.exchange_rate:=1;
  return new;
end $$;
