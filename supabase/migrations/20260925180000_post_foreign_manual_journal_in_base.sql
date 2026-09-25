-- Posted journals and ledgers remain in company base amounts. For foreign
-- manual journals preserve source amounts in separate immutable line columns.
alter table public.journal_lines add column source_debit numeric(24,2),
  add column source_credit numeric(24,2);

create or replace function public.guard_journal_line_accounting_rules()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_status text; v_rate numeric;
begin
  if coalesce(new.debit,0)<0 or coalesce(new.credit,0)<0 then
    raise exception 'Debit and credit cannot be negative.';
  end if;
  if (coalesce(new.debit,0)>0 and coalesce(new.credit,0)>0) or
     (coalesce(new.debit,0)=0 and coalesce(new.credit,0)=0) then
    raise exception 'Each journal line must contain either debit or credit.';
  end if;
  select status,exchange_rate into v_status,v_rate from public.journal_entries where id=new.entry_id;
  if v_status='posted' and current_setting('app.maintenance_reset',true) is distinct from '1' then
    raise exception 'Lines of a posted journal entry cannot be changed.';
  end if;
  if new.source_debit is not null or new.source_credit is not null then
    if new.source_debit is null or new.source_credit is null or
       new.source_debit<0 or new.source_credit<0 or
       round(new.source_debit*v_rate,2) is distinct from round(new.debit,2) or
       round(new.source_credit*v_rate,2) is distinct from round(new.credit,2) then
      raise exception 'Foreign journal line conversion does not match its locked exchange rate';
    end if;
    new.base_debit:=round(new.debit,2);
    new.base_credit:=round(new.credit,2);
  else
    new.base_debit:=round(coalesce(new.debit,0)*coalesce(v_rate,1),2);
    new.base_credit:=round(coalesce(new.credit,0)*coalesce(v_rate,1),2);
  end if;
  return new;
end $$;

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
    elsif new.exchange_rate is distinct from 1::numeric then
      raise exception 'Base currency journal rate must be one';
    end if;
  end if;
  return new;
end $$;

create function public.post_foreign_manual_journal(p_entry_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_entry public.journal_entries%rowtype; v_base text; v_count int;
  v_source_debit numeric; v_source_credit numeric; v_base_debit numeric; v_base_credit numeric;
begin
  perform public.assert_module_permission('accounting','post');
  select * into v_entry from public.journal_entries where id=p_entry_id
    and user_id=public.legacy_data_user_id() and company_id=public.current_company_id()
    and business_unit_id=public.current_business_unit_id()
    and operating_location_id=public.current_operating_location_id() for update;
  if not found or v_entry.status<>'draft' then raise exception 'Draft journal not found in active workspace'; end if;
  if coalesce(v_entry.trans_type,'') not in ('','Journal Entry','Manual Journal') then
    raise exception 'Only manual journals may use foreign conversion';
  end if;
  select base_currency_code into v_base from public.companies where id=v_entry.company_id;
  if v_entry.currency_code=v_base or v_entry.exchange_rate<=0 then
    raise exception 'Use standard posting for base currency journals';
  end if;
  if exists(select 1 from public.ledgers where journal_entry_id=p_entry_id) or
     exists(select 1 from public.journal_lines where entry_id=p_entry_id
       and (source_debit is not null or source_credit is not null)) then
    raise exception 'This foreign journal was already converted or posted';
  end if;
  select count(*),coalesce(sum(debit),0),coalesce(sum(credit),0),
    coalesce(sum(base_debit),0),coalesce(sum(base_credit),0)
  into v_count,v_source_debit,v_source_credit,v_base_debit,v_base_credit
  from public.journal_lines where entry_id=p_entry_id and company_id=v_entry.company_id
    and business_unit_id=v_entry.business_unit_id and operating_location_id=v_entry.operating_location_id;
  if v_count<2 or v_source_debit<=0 or abs(v_source_debit-v_source_credit)>=0.01 or
     abs(v_base_debit-v_base_credit)>=0.01 or v_base_debit<=0 then
    raise exception 'Foreign journal must balance in both source and base currency';
  end if;
  update public.journal_lines set source_debit=debit,source_credit=credit,
    debit=base_debit,credit=base_credit
  where entry_id=p_entry_id and company_id=v_entry.company_id
    and business_unit_id=v_entry.business_unit_id and operating_location_id=v_entry.operating_location_id;
  return public.post_journal_entry(p_entry_id);
end $$;
revoke all on function public.post_foreign_manual_journal(uuid) from public,anon;
grant execute on function public.post_foreign_manual_journal(uuid) to authenticated;
