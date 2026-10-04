do $migration$
declare v text;
begin
 select pg_get_functiondef(p.oid) into v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='transport_register_query'
 and pg_get_function_identity_arguments(p.oid)='p_limit integer, p_offset integer, p_filters jsonb, p_sort text, p_direction text, p_option_key text, p_option_search text';
 if v is null then raise exception 'transport_register_query not found'; end if;
 if position('coalesce(r.lifecycle_status,r.status) status' in v)=0 then raise exception 'Expected legacy Trip status expression not found'; end if;
 v:=replace(v,'coalesce(r.lifecycle_status,r.status) status','coalesce(r.trip_status,r.status) status');
 execute v;
end $migration$;