begin;

do $migration$
declare
  v_oid oid;
  v_definition text;
  v_repaired text;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='reverse_payment_voucher'
    and pg_get_function_identity_arguments(p.oid)='p_journal_entry_id uuid, p_reversal_date date, p_reason text';

  if v_oid is null then raise exception 'reverse_payment_voucher(uuid,date,text) is missing'; end if;
  v_definition:=pg_get_functiondef(v_oid);
  v_repaired:=replace(v_definition,'v_actor::text,auth.jwt()->>''email''','v_actor,auth.jwt()->>''email''');
  if v_repaired=v_definition then
    raise exception 'reverse_payment_voucher audit actor patch pattern did not match';
  end if;
  execute v_repaired;
end;
$migration$;

revoke all on function public.reverse_payment_voucher(uuid,date,text) from public,anon;
grant execute on function public.reverse_payment_voucher(uuid,date,text) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
