begin;
do $inline$
declare d text;q text;native text;anchor text;
begin
 select prosrc into q from pg_proc where oid='public._transport_opening_register_rows(uuid,uuid,uuid)'::regprocedure;
 if position('begin return query ' in q)<>1 then raise exception 'Unexpected opening custom-plan source';end if;
 q:=substring(q from length('begin return query ')+1);q:=regexp_replace(q,';end;[[:space:]]*$','');
 q:=replace(q,'LEFT JOIN customers c ON c.id = t.customer_id','LEFT JOIN customers cu ON cu.id = t.customer_id');
 q:=replace(q,'COALESCE(c.name, t.customer_name_snapshot)','COALESCE(cu.name, t.customer_name_snapshot)');
 q:=replace(q,'$1','c');q:=replace(q,'$2','b');q:=replace(q,'$3','loc');
 native:=pg_get_functiondef('public._transport_linked_register_source(uuid,uuid,uuid)'::regprocedure);
 native:=replace(native,'public._transport_linked_register_source(','public._transport_native_register_rows(');
 anchor:='return query select * from public._transport_opening_register_rows(p_company,p_unit,p_location);';
 if position(anchor in native)=0 then raise exception 'Unexpected native source fallback';end if;
 native:=replace(native,anchor,'-- Imported rows are projected by the caller; only native fallback rows are returned here.');
 execute native;
 revoke all on function public._transport_native_register_rows(uuid,uuid,uuid) from public,anon,authenticated;
 d:=pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
 anchor:='with register_source as materialized (select r.* from public._transport_linked_register_source(c,b,loc) r), agreed_rents as materialized (';
 if position(anchor in d)=0 then raise exception 'Unexpected Register source CTE';end if;
 d:=replace(d,anchor,'with register_source as not materialized (select r.* from ('||q||') r union all select r.* from public._transport_native_register_rows(c,b,loc) r), agreed_rents as materialized (');
 execute d;
end $inline$;
notify pgrst,'reload schema';
commit;
