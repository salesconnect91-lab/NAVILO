begin;

-- Mixed-rate settlement support.
-- A foreign journal can legitimately contain source-currency lines valued at
-- different rates (for example AR/AP at original invoice rate and Cash/Bank at
-- settlement-date rate). Keep the journal header rate as the transaction/default
-- rate, but audit each source-currency line with its own locked rate.

alter table public.journal_lines
  add column if not exists source_exchange_rate numeric(24,10);

alter table public.journal_lines
  drop constraint if exists journal_lines_source_exchange_rate_check;

alter table public.journal_lines
  add constraint journal_lines_source_exchange_rate_check
  check (
    source_exchange_rate is null
    or source_exchange_rate > 0
  );

comment on column public.journal_lines.source_exchange_rate is
  'Locked FX rate used by this source-currency journal line. Defaults logically to the journal rate when null; settlements may use different rates per line.';

create or replace function public.guard_journal_line_accounting_rules()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_status text;
  v_rate numeric;
  v_currency text;
  v_base text;
  v_line_rate numeric;
begin
  if coalesce(new.debit,0)<0 or coalesce(new.credit,0)<0 then
    raise exception 'Debit and credit cannot be negative.';
  end if;

  if (coalesce(new.debit,0)>0 and coalesce(new.credit,0)>0)
     or (coalesce(new.debit,0)=0 and coalesce(new.credit,0)=0) then
    raise exception 'Each journal line must contain either debit or credit.';
  end if;

  select je.status,je.exchange_rate,je.currency_code,c.base_currency_code
    into v_status,v_rate,v_currency,v_base
  from public.journal_entries je
  join public.companies c on c.id=je.company_id
  where je.id=new.entry_id;

  if v_status is null then
    raise exception 'Journal entry not found for journal line.';
  end if;

  if v_status='posted'
     and current_setting('app.maintenance_reset',true) is distinct from '1' then
    raise exception 'Lines of a posted journal entry cannot be changed.';
  end if;

  if v_currency is distinct from v_base then
    if new.amount_basis is null then
      new.amount_basis:='source_currency';
    end if;

    if new.amount_basis='source_currency' then
      v_line_rate:=coalesce(new.source_exchange_rate,v_rate);

      if v_line_rate is null or v_line_rate<=0 then
        raise exception 'Foreign source-currency journal line requires a positive locked exchange rate.';
      end if;

      new.source_exchange_rate:=v_line_rate;

      if new.source_debit is null and new.source_credit is null then
        if v_status <> 'draft' then
          raise exception
            'Posted foreign source-currency journal line requires source debit and credit audit amounts.';
        end if;

        new.base_debit:=round(coalesce(new.debit,0)*v_line_rate,2);
        new.base_credit:=round(coalesce(new.credit,0)*v_line_rate,2);
        return new;

      elsif new.source_debit is null or new.source_credit is null then
        raise exception
          'Foreign source debit and credit must either both be supplied or both be omitted.';
      end if;

      if new.source_debit<0 or new.source_credit<0
         or round(new.source_debit*v_line_rate,2) is distinct from round(new.debit,2)
         or round(new.source_credit*v_line_rate,2) is distinct from round(new.credit,2) then
        raise exception 'Foreign journal line conversion does not match its locked exchange rate';
      end if;

    elsif new.amount_basis='base_currency' then
      if new.source_debit is not null
         or new.source_credit is not null
         or new.source_exchange_rate is not null then
        raise exception 'Base-currency journal line must not contain foreign source amounts or source exchange rate.';
      end if;

    else
      raise exception 'Foreign journal line requires a valid accounting amount basis.';
    end if;

    new.base_debit:=round(coalesce(new.debit,0),2);
    new.base_credit:=round(coalesce(new.credit,0),2);

  else
    if new.amount_basis='source_currency' then
      raise exception 'Base-currency journal cannot contain foreign source-currency lines.';
    end if;

    new.amount_basis:=coalesce(new.amount_basis,'base_currency');

    if new.source_exchange_rate is not null
       and new.source_exchange_rate is distinct from 1::numeric then
      raise exception 'Base-currency journal line source exchange rate must be one or null.';
    end if;

    if new.source_debit is not null or new.source_credit is not null then
      if new.source_debit is null or new.source_credit is null
         or new.source_debit<0 or new.source_credit<0
         or round(new.source_debit*coalesce(new.source_exchange_rate,v_rate,1),2) is distinct from round(new.debit,2)
         or round(new.source_credit*coalesce(new.source_exchange_rate,v_rate,1),2) is distinct from round(new.credit,2) then
        raise exception 'Journal source/base audit amounts are inconsistent.';
      end if;
    end if;

    new.source_exchange_rate:=null;
    new.base_debit:=round(coalesce(new.debit,0),2);
    new.base_credit:=round(coalesce(new.credit,0),2);
  end if;

  return new;
end;
$$;

revoke all on function public.guard_journal_line_accounting_rules()
  from public,anon,authenticated;

create or replace function public.guard_unconverted_foreign_journal_posting()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_base text;
  v_count integer;
  v_debit numeric;
  v_credit numeric;
begin
  if new.status='posted'
     and (tg_op='INSERT' or old.status is distinct from 'posted') then

    select base_currency_code
      into v_base
    from public.companies
    where id=new.company_id;

    if v_base is null then
      raise exception 'Journal company has no base currency.';
    end if;

    if new.currency_code is distinct from v_base then
      if new.exchange_rate is null or new.exchange_rate<=0 then
        raise exception 'Foreign journal requires a positive locked exchange rate.';
      end if;

      select count(*),coalesce(sum(jl.debit),0),coalesce(sum(jl.credit),0)
        into v_count,v_debit,v_credit
      from public.journal_lines jl
      where jl.entry_id=new.id;

      if v_count<2 or v_debit<=0 or abs(v_debit-v_credit)>=0.01 then
        raise exception
          'Foreign journal must be balanced in company base currency before posting.';
      end if;

      if exists (
        select 1
        from public.journal_lines jl
        where jl.entry_id=new.id
          and (
            jl.amount_basis is null
            or (
              jl.amount_basis='source_currency'
              and (
                jl.source_debit is null
                or jl.source_credit is null
                or coalesce(jl.source_exchange_rate,new.exchange_rate) is null
                or coalesce(jl.source_exchange_rate,new.exchange_rate)<=0
                or round(jl.source_debit*coalesce(jl.source_exchange_rate,new.exchange_rate),2)
                     is distinct from round(jl.debit,2)
                or round(jl.source_credit*coalesce(jl.source_exchange_rate,new.exchange_rate),2)
                     is distinct from round(jl.credit,2)
                or jl.base_debit is distinct from round(jl.debit,2)
                or jl.base_credit is distinct from round(jl.credit,2)
              )
            )
            or (
              jl.amount_basis='base_currency'
              and (
                jl.source_debit is not null
                or jl.source_credit is not null
                or jl.source_exchange_rate is not null
                or jl.base_debit is distinct from round(jl.debit,2)
                or jl.base_credit is distinct from round(jl.credit,2)
              )
            )
          )
      ) then
        raise exception
          'Foreign journal contains an invalid source/base currency line.';
      end if;

      if (select count(*) from public.ledgers where journal_entry_id=new.id) <> v_count
         or exists (
           select 1
           from public.journal_lines jl
           where jl.entry_id=new.id
             and not exists (
               select 1
               from public.ledgers l
               where l.journal_entry_id=new.id
                 and l.journal_line_id=jl.id
                 and l.user_id=jl.user_id
                 and l.company_id=jl.company_id
                 and l.business_unit_id=jl.business_unit_id
                 and l.account_id=jl.account_id
                 and l.debit=jl.debit
                 and l.credit=jl.credit
             )
         ) then
        raise exception
          'Foreign journal requires matching base-currency ledger rows before posting.';
      end if;

    elsif new.exchange_rate is distinct from 1::numeric then
      raise exception 'Base currency journal rate must be one.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_unconverted_foreign_journal_posting()
  from public,anon,authenticated;

commit;
