begin;

-- Return-note payment status is already recalculated by the return_notes trigger.
-- The posting RPC must not subtract the same return a second time.
do $migration$
declare
  v_oid oid;
  v_definition text;
  v_repaired text;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='create_and_post_return_note_internal'
    and pg_get_function_identity_arguments(p.oid)='p_note_type text, p_order_id uuid, p_note_date date, p_reason text, p_lines jsonb';

  if v_oid is null then raise exception 'create_and_post_return_note_internal is missing'; end if;
  v_definition:=pg_get_functiondef(v_oid);

  v_repaired:=regexp_replace(
    v_definition,
    E'\\n  if p_note_type=''sales_credit'' and v_payment_mode not in \\(''cash'',''bank''\\) then[\\s\\S]*?\\n  end if;',
    '',
    'n'
  );

  if v_repaired=v_definition then
    raise exception 'Return double-outstanding patch pattern did not match';
  end if;

  execute v_repaired;
end;
$migration$;

revoke all on function public.create_and_post_return_note_internal(text,uuid,date,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.create_and_post_return_note_internal(text,uuid,date,text,jsonb)
  to service_role;

notify pgrst,'reload schema';
commit;
