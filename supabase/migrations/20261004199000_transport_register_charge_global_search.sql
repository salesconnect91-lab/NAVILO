do $migration$
declare v text;
begin
 select pg_get_functiondef(p.oid) into v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='transport_register_query'
 and pg_get_function_identity_arguments(p.oid)='p_limit integer, p_offset integer, p_filters jsonb, p_sort text, p_direction text, p_option_key text, p_option_search text';
 if v is null then raise exception 'transport_register_query not found'; end if;
 if position('''to'',coalesce(nullif(r.to_location,''''),''?''),' in v)=0 then raise exception 'Expected register cell block not found'; end if;
 if position('x.vals->''cells''->>''to'',x.vals->''cells''->>''paper_received_by''' in v)=0 then raise exception 'Expected register global-search block not found'; end if;
 v:=replace(v,
   '''to'',coalesce(nullif(r.to_location,''''),''?''),',
   '''to'',coalesce(nullif(r.to_location,''''),''?''),''charge'',coalesce(nullif((select string_agg(tc.code_snapshot,'' + '' order by tc.sort_order,tc.id) from public.transport_trip_customer_charges tc where tc.trip_id=r.id),''''),''?''),');
 v:=replace(v,
   'x.vals->''cells''->>''to'',x.vals->''cells''->>''paper_received_by''',
   'x.vals->''cells''->>''to'',x.vals->''cells''->>''charge'',x.vals->''cells''->>''paper_received_by''');
 execute v;
end $migration$;

notify pgrst,'reload schema';
