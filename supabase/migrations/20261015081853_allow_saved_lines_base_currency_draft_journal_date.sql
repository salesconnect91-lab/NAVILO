-- NAVILO: Allow changing the date of a Draft base-currency journal
-- even when saved lines exist. No journal rows or ledger records are altered.
-- Applied to production as Supabase migration 20261015081853.
do $preflight$
declare v_def text;
begin
  if to_regprocedure('public.guard_journal_fx_snapshot()') is null then
    raise exception 'Expected journal FX guard is missing';
  end if;
  select pg_get_functiondef('public.guard_journal_fx_snapshot()'::regprocedure) into v_def;
  if position('Remove draft journal lines before changing currency, rate, date or company' in v_def) = 0
     and position('Remove draft journal lines before changing foreign currency, rate, date or company' in v_def) = 0 then
    raise exception 'Journal FX guard has changed; abort safe patch';
  end if;
end $preflight$;
create or replace function public.guard_journal_fx_snapshot()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_base text; v_rate numeric;
begin
  if tg_op='UPDATE' and old.status='posted' then
    if new.currency_code is distinct from old.currency_code or
       new.exchange_rate is distinct from old.exchange_rate or
       new.entry_date is distinct from old.entry_date or
       new.company_id is distinct from old.company_id then
      raise exception 'Posted journal currency, rate, date and company are immutable';
    end if;
    return new;
  end if;
  select c.base_currency_code into v_base from public.companies c where c.id=new.company_id;
  if v_base is null then raise exception 'Journal company is required for currency conversion'; end if;
  if tg_op='INSERT' then new.currency_code:=coalesce(new.currency_code,v_base); end if;
  if new.currency_code is null then raise exception 'Journal currency is required'; end if;
  if tg_op='UPDATE'
     and exists(select 1 from public.journal_lines where entry_id=old.id)
     and (
       new.currency_code is distinct from old.currency_code or
       new.company_id is distinct from old.company_id or
       new.exchange_rate is distinct from old.exchange_rate or
       (
         new.entry_date is distinct from old.entry_date
         and (
           new.currency_code is distinct from v_base
           or old.currency_code is distinct from v_base
           or old.exchange_rate is distinct from 1::numeric
         )
       )
     ) then
    raise exception 'Remove draft journal lines before changing foreign currency, rate, date or company';
  end if;
  if tg_op='INSERT' or new.currency_code is distinct from old.currency_code or
     new.entry_date is distinct from old.entry_date or new.company_id is distinct from old.company_id then
    if new.currency_code=v_base then
      v_rate:=1;
    else
      select r.rate into v_rate from public.company_exchange_rates r
      where r.company_id=new.company_id and r.base_currency_code=v_base
        and r.foreign_currency_code=new.currency_code and r.effective_on<=new.entry_date
      order by r.effective_on desc,r.recorded_at desc,r.id desc limit 1;
      if v_rate is null then raise exception 'No company exchange rate for % on %',new.currency_code,new.entry_date; end if;
    end if;
    new.exchange_rate:=v_rate;
  elsif new.exchange_rate is distinct from old.exchange_rate then
    raise exception 'Exchange rate is derived from company effective date history';
  end if;
  return new;
end $$;
revoke all on function public.guard_journal_fx_snapshot() from public,anon,authenticated;