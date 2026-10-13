-- Both internal source readers already enforce the exact company / BU / location.
-- Reapplying equality estimates to their materialized result made PostgreSQL
-- assume one Trip and repeatedly scan ownership rows for the entire imported book.
do $budget$ declare body text; begin
 select pg_get_functiondef('public.transport_trip_report(text,integer,integer,jsonb)'::regprocedure) into body;
 if position('public._transport_opening_register_rows(c,b,loc)' in body)=0
 or position('public._transport_native_register_rows(c,b,loc)' in body)=0
 then raise exception 'Expected scoped report sources';end if;
 body:=replace(body,'where not(cv and sv) and fr.company_id=c and fr.business_unit_id=b) r','where not(cv and sv)) r');
 body:=replace(body,'where r.company_id=c and r.business_unit_id=b','where true');
 execute body;
end $budget$;
notify pgrst,'reload schema';
