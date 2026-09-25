-- The journal lines record their source currency, while the current ledger and
-- party-ledger posting RPCs copy debit/credit without converting them to base.
-- Until the entire posting/reversal chain consumes base amounts, foreign
-- journals must stay drafts. No existing posted history is changed.
create function public.guard_unconverted_foreign_journal_posting()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_base text;
begin
  if new.status='posted' and (tg_op='INSERT' or old.status is distinct from 'posted') then
    select base_currency_code into v_base from public.companies where id=new.company_id;
    if new.currency_code is distinct from v_base or new.exchange_rate is distinct from 1::numeric then
      raise exception 'Foreign-currency journal posting requires base-currency ledger and reversal support';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_unconverted_foreign_journal_posting() from public,anon,authenticated;
create trigger zz_guard_unconverted_foreign_journal_posting
before insert or update of status on public.journal_entries
for each row execute function public.guard_unconverted_foreign_journal_posting();
