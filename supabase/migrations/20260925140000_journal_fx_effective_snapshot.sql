-- Existing entries are untouched. New journals take their company base currency
-- unless an explicit foreign currency is supplied. One unit of foreign currency
-- converts to `rate` units of the company's base currency.
alter table public.journal_entries alter column currency_code drop default;
alter table public.journal_entries alter column exchange_rate drop default;

create function public.company_exchange_rate_on(p_company_id uuid, p_currency_code text, p_on date)
returns numeric language sql stable security definer set search_path=public,pg_temp as $$
  select case when p_company_id=public.current_company_id()
                 and public.has_company_access(p_company_id) or public.is_platform_owner()
    then (select case when p_currency_code=c.base_currency_code then 1::numeric
      else (select r.rate from public.company_exchange_rates r
        where r.company_id=c.id and r.base_currency_code=c.base_currency_code
          and r.foreign_currency_code=p_currency_code and r.effective_on<=p_on
        order by r.effective_on desc,r.recorded_at desc,r.id desc limit 1) end
      from public.companies c where c.id=p_company_id)
    else null end;
$$;
revoke all on function public.company_exchange_rate_on(uuid,text,date) from public,anon;
grant execute on function public.company_exchange_rate_on(uuid,text,date) to authenticated;

create function public.guard_journal_fx_snapshot() returns trigger language plpgsql
security definer set search_path=public,pg_temp as $$
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
  if tg_op='UPDATE' and
     (new.currency_code is distinct from old.currency_code or
      new.entry_date is distinct from old.entry_date or
      new.company_id is distinct from old.company_id or
      new.exchange_rate is distinct from old.exchange_rate) and
     exists(select 1 from public.journal_lines where entry_id=old.id) then
    raise exception 'Remove draft journal lines before changing currency, rate, date or company';
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
create trigger zz_guard_journal_fx_snapshot before insert or update of
  company_id,currency_code,exchange_rate,entry_date,status on public.journal_entries
for each row execute function public.guard_journal_fx_snapshot();
