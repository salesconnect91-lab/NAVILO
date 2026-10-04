begin;
-- Bound the party dataset at the server before page delivery. Retain all events
-- before From for opening balances; To applies to historical outstanding.
create or replace function public.transport_party_report_query(p_kind text,p_side text,p_filters jsonb default '{}',p_limit integer default 1000,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();relation text;date_key text;answer jsonb;party uuid;until_date date;query_text text;
begin
 if auth.uid() is null or c is null or b is null or loc is null or not public.transport_financial_read_allowed(p_side) then raise exception 'Transport side view and active Company/Business Unit/branch required';end if;
 if jsonb_typeof(p_filters) is distinct from 'object' or octet_length(p_filters::text)>10000 then raise exception 'Invalid report filters';end if;
 if p_kind='canonical' and not public.has_module_permission(c,'accounting','view') then raise exception 'Accounting view permission required';end if;
 relation:=case p_kind when 'documents' then 'transport_party_documents' when 'movements' then 'transport_party_movements' when 'canonical' then 'transport_canonical_party_movements' end;
 if relation is null then raise exception 'Invalid report kind';end if;
 date_key:=case when p_kind='documents' then 'order_date' else 'event_date' end;
 party:=nullif(p_filters->>'party','')::uuid;until_date:=nullif(p_filters->>'to','')::date;
 query_text:=format('select coalesce(jsonb_agg(to_jsonb(q)),''[]'') from (select r.* from public.%I r where company_id=$1 and business_unit_id=$2 and operating_location_id=$3 and side=$4 and ($5 is null or party_id=$5) and ($6 is null or %I<=$6) and ($7='''' or position(lower($7) in lower(concat_ws('' '',to_jsonb(r)->>''trip_no'',to_jsonb(r)->>''order_no'',to_jsonb(r)->>''party_name'')))>0) order by %I limit $8 offset $9) q',relation,date_key,case when p_kind='documents' then 'order_id' else 'event_id' end);
 execute query_text into answer using c,b,loc,p_side,party,until_date,case when p_kind='canonical' then '' else coalesce(p_filters->>'search','') end,greatest(1,least(coalesce(p_limit,1000),1000)),greatest(coalesce(p_offset,0),0);
 return answer;
end $$;
revoke all on function public.transport_party_report_query(text,text,jsonb,integer,integer) from public,anon;
grant execute on function public.transport_party_report_query(text,text,jsonb,integer,integer) to authenticated;

-- Remove unnecessary anonymous ordinary-object/RPC privileges, preserving
-- authenticated access that existed before the change and internal-only APIs.
do $$ declare f record;t record;was_authenticated boolean;begin
 for f in select p.oid,p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'transport_%' loop
 was_authenticated:=has_function_privilege('authenticated',f.oid,'execute');
 execute format('revoke all on function %s from public,anon',f.signature);
 if was_authenticated then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
 for t in select c.oid,c.oid::regclass relation from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and (c.relname like 'transport_%' or c.relname='transporters') and c.relkind in ('r','v','m','p') loop
 execute format('revoke all on %s from public,anon',t.relation);
 end loop;
end $$;

-- Drop only exact semantic duplicates, never constraint/replica identity indexes.
-- No extra business uniqueness rule is introduced or removed.
do $$ declare duplicate record;begin
 for duplicate in
 select distinct a.indexrelid::regclass relation
 from pg_index a join pg_index b on a.indrelid=b.indrelid and a.indexrelid<>b.indexrelid
 join pg_class ac on ac.oid=a.indexrelid join pg_class bc on bc.oid=b.indexrelid
 join pg_class t on t.oid=a.indrelid join pg_namespace n on n.oid=t.relnamespace
 where n.nspname='public' and t.relname like 'transport_%'
 and a.indisvalid and b.indisvalid and a.indisready and b.indisready
 and a.indisunique=b.indisunique and a.indisprimary=b.indisprimary and a.indnullsnotdistinct=b.indnullsnotdistinct and ac.relam=bc.relam and a.indnatts=b.indnatts
 and a.indkey=b.indkey and a.indclass=b.indclass and a.indcollation=b.indcollation and a.indoption=b.indoption and a.indnkeyatts=b.indnkeyatts
 and coalesce(pg_get_expr(a.indexprs,a.indrelid),'')=coalesce(pg_get_expr(b.indexprs,b.indrelid),'')
 and coalesce(pg_get_expr(a.indpred,a.indrelid),'')=coalesce(pg_get_expr(b.indpred,b.indrelid),'')
 and not a.indisreplident and not exists(select 1 from pg_constraint where conindid=a.indexrelid)
 and (exists(select 1 from pg_constraint where conindid=b.indexrelid) or bc.relname<ac.relname)
 loop
 execute format('drop index if exists %s',duplicate.relation);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
