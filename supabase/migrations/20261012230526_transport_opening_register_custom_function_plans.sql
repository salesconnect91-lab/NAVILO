begin;
do $plans$
declare d text;
begin
 select prosrc into d from pg_proc where oid='public._transport_opening_register_rows(uuid,uuid,uuid)'::regprocedure;
 if position('with financial_ids as materialized' in d)<>1 then raise exception 'Unexpected opening row query';end if;
 -- SQL-language functions use a generic parameter plan even when the caller
 -- has force_custom_plan. RETURN QUERY in PL/pgSQL preserves the exact row
 -- projection while planning with the active Company/Unit/Location values.
 execute 'create or replace function public._transport_opening_register_rows(uuid,uuid,uuid) returns setof public.transport_financial_register language plpgsql stable security invoker rows 20000 set search_path=public,pg_temp set plan_cache_mode=force_custom_plan set work_mem=''64MB'' as '||quote_literal('begin return query '||d||';end;');
 revoke all on function public._transport_opening_register_rows(uuid,uuid,uuid) from public,anon,authenticated;
end $plans$;
alter function public._transport_linked_register_source(uuid,uuid,uuid) set plan_cache_mode=force_custom_plan;
notify pgrst,'reload schema';
commit;
