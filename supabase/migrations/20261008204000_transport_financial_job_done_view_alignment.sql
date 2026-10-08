-- The generated Transport job_status is 'done' when PO/DO/Job No is present.
-- Isolated migration replay still had the old 'completed' only close rule.
-- Production already recognizes both values. Preserve every other close check.
do $$
declare v_definition text; v_fixed text;
begin
 select pg_get_viewdef('public.transport_trip_financial_summary'::regclass,true)
 into v_definition;
 if position('job_status = ANY (ARRAY[' in v_definition)>0
   and position('''done''::text' in v_definition)>0 then
   return;
 end if;
 if position('job_status = ''completed''::text' in v_definition)=0 then
   raise exception 'Unexpected financial summary job-status rule. No change applied.';
 end if;
 v_fixed:=replace(v_definition,
   'job_status = ''completed''::text',
   'job_status = ANY (ARRAY[''completed''::text, ''done''::text])'
 );
 execute format('create or replace view public.transport_trip_financial_summary as %s',v_fixed);
end $$;
do $$
declare v_definition text;
begin
 select pg_get_viewdef('public.transport_trip_financial_summary'::regclass,true) into v_definition;
 if position('job_status = ANY (ARRAY[' in v_definition)=0
   or position('''done''::text' in v_definition)=0
 then raise exception 'Transport financial job-status alignment failed'; end if;
end $$;
