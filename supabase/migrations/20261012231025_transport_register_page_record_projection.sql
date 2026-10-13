-- Sort/filter/aggregate compact rows. Fetch the full source record only after
-- the selected page is known, rather than copying it through every CTE.
begin;
do $record$
declare d text;anchor text;
begin
 d:=pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
 anchor:='select r.id,r.trip_date,r.payment_date,r.trip_no,r full_row,';
 if position(anchor in d)=0 or position('to_jsonb(chosen.full_row)' in d)=0 then raise exception 'Unexpected Register full-row projection';end if;
 d:=replace(d,anchor,'select r.id,r.trip_date,r.payment_date,r.trip_no,null::public.transport_financial_register full_row,');
 d:=replace(d,'to_jsonb(chosen.full_row)','to_jsonb(fr)');
 d:=replace(d,E'from chosen\n ), filtered_agg as materialized',E'from chosen join register_source fr on fr.id=chosen.id\n ), filtered_agg as materialized');
 execute d;
end $record$;
notify pgrst,'reload schema';
commit;
