-- Source values may contain fractions of a cent. Preserve their precision while
-- totaling reports; currency formatting rounds for display, without changing evidence.
do $precision$ declare body text; begin
 select pg_get_functiondef('public.transport_trip_report(text,integer,integer,jsonb)'::regprocedure) into body;
 body:=replace(body,'round(cl.original_gross,2)','cl.original_gross');
 body:=replace(body,'round(cl.original_gross-cl.original_net,2)','cl.original_gross-cl.original_net');
 body:=replace(body,'round(sl.original_gross,2)','sl.original_gross');
 body:=replace(body,'round(sl.original_gross-sl.original_net,2)','sl.original_gross-sl.original_net');
 execute body;
end $precision$;
notify pgrst,'reload schema';

-- Include the party identity on native detail DTOs as well as imported DTOs.
do $party$ declare body text; begin
 select pg_get_functiondef('public.transport_document_trip_detail_query(text,jsonb,integer,integer)'::regprocedure) into body;
 if position('select src.order_id,src.order_no' in body)>0 then
  body:=replace(body,'select src.order_id,src.order_no','select src.party_id,src.order_id,src.order_no');
  execute body;
 end if;
end $party$;
