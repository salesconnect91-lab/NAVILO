-- A foreign journal can become posted only after its base-currency ledger
-- rows have been written by the posting RPC. Do not alter posted history.
create or replace function public.guard_unconverted_foreign_journal_posting()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_base text; v_count int; v_debit numeric; v_credit numeric;
begin
  if new.status='posted' and (tg_op='INSERT' or old.status is distinct from 'posted') then
    select base_currency_code into v_base from public.companies where id=new.company_id;
    if new.currency_code is distinct from v_base then
      select count(*),coalesce(sum(debit),0),coalesce(sum(credit),0)
        into v_count,v_debit,v_credit from public.journal_lines
      where entry_id=new.id and source_debit is not null and source_credit is not null
        and base_debit=debit and base_credit=credit
        and round(source_debit*new.exchange_rate,2)=round(debit,2)
        and round(source_credit*new.exchange_rate,2)=round(credit,2);
      if v_count=0 or v_count<>(select count(*) from public.journal_lines where entry_id=new.id)
         or abs(v_debit-v_credit)>=0.01 or v_debit<=0 then
        raise exception 'Foreign journal must be converted and balanced in company base currency before posting';
      end if;
      if (select count(*) from public.ledgers where journal_entry_id=new.id)<>v_count
         or exists (
           select 1 from public.journal_lines jl
           where jl.entry_id=new.id and not exists (
             select 1 from public.ledgers l
             where l.journal_entry_id=new.id and l.journal_line_id=jl.id
               and l.user_id=jl.user_id and l.company_id=jl.company_id
               and l.business_unit_id=jl.business_unit_id
               and l.account_id=jl.account_id
               and l.debit=jl.debit and l.credit=jl.credit
           )
         ) then
        raise exception 'Foreign journal requires matching base-currency ledger rows before posting';
      end if;
    elsif new.exchange_rate is distinct from 1::numeric then
      raise exception 'Base currency journal rate must be one';
    end if;
  end if;
  return new;
end $$;
