begin;
create index if not exists party_ledgers_running_balance_idx on public.party_ledgers(user_id,business_unit_id,party_type,party_id,entry_date,created_at,id);
do $patch$
declare f text; old_clause text:='where pl.id=running.id';
begin
 if to_regprocedure('public.recalculate_party_ledger_balance()') is null then return;end if;
 f:=pg_get_functiondef('public.recalculate_party_ledger_balance()'::regprocedure);
 if strpos(f,old_clause)=0 then raise exception 'Expected running balance update missing';end if;
 execute replace(f,old_clause,'where pl.id=running.id and pl.balance is distinct from running.running_balance');
end $patch$;
commit;
