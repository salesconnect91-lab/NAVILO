-- Apply approved receiver correction at the register read boundary only.
-- Never mutate the historical import or PPR date.
do $migration$
declare definition text; anchor text; replacement text;
begin
 select pg_get_functiondef(oid) into definition from pg_proc where proname='transport_register_query' and pronamespace='public'::regnamespace;
 anchor := 'return answer||jsonb_build_object(''permissions'',jsonb_build_object(''customer'',cv,''supplier'',sv));';
 replacement := $body$
 if p_option_key is null and jsonb_typeof(answer->'rows')='array' then
   answer:=jsonb_set(answer,'{rows}',coalesce((
      select jsonb_agg(case when pc.trip_id is not null then
        jsonb_set(r.value,'{ppr_received_by_name}',to_jsonb(pc.corrected_name))
        else r.value end order by r.ord)
      from jsonb_array_elements(answer->'rows') with ordinality r(value,ord)
      left join public.transport_ppr_receiver_corrections pc
       on pc.trip_id=case when r.value->>'id' ~* '^[0-9a-f-]{36}$' then (r.value->>'id')::uuid else null end
       and pc.company_id=c and pc.business_unit_id=b
   ),'[]'::jsonb));
 end if;
 return answer||jsonb_build_object('permissions',jsonb_build_object('customer',cv,'supplier',sv));$body$;
 if position(anchor in definition)=0 then raise exception 'Register reader changed: abort patch';end if;
 execute replace(definition,anchor,replacement);
end $migration$;
