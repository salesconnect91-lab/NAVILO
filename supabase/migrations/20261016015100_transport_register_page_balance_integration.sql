-- Use the permission-scoped, exact document reader for the visible 100-Trip
-- page. Missing document evidence retains the canonical opening/draft balance.
-- Export pages above 100 keep the existing canonical path and full totals.
do $migration$
declare
 definition text:=pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
 old_page text:=$old$), page as (
  select case when cv and sv then to_jsonb(fr)$old$;
 new_page text:=$new$), balance_page_ids as materialized (
   select array_agg(id order by ordinal) ids from chosen
   having count(*) between 1 and 100 and (cv or sv)
 ), page_document_balances as materialized (
   select balances.* from balance_page_ids ids
   cross join lateral public.transport_register_page_document_outstanding(ids.ids) balances
 ), page as (
  select case when cv and sv then to_jsonb(fr)$new$;
 old_row text:=$old$'supplier_invoice_no',case when sv then nullif(coalesce(si_page.order_nos,chosen.supplier_invoice_no),'') end) row,chosen.ordinal$old$;
 new_row text:=$new$'supplier_invoice_no',case when sv then nullif(coalesce(si_page.order_nos,chosen.supplier_invoice_no),'') end,
   'customer_outstanding_gross',case when cv then coalesce(pb.customer_outstanding_gross,fr.customer_outstanding_gross) end,
   'supplier_outstanding_gross',case when sv then coalesce(pb.supplier_outstanding_gross,fr.supplier_outstanding_gross) end) row,chosen.ordinal$new$;
begin
 if position('page_document_balances as materialized' in definition)>0 then
   raise notice 'Page document balances already integrated'; return;
 end if;
 if to_regprocedure('public.transport_register_page_document_outstanding(uuid[])') is null
 or position(old_page in definition)=0 or position(old_row in definition)=0
 then raise exception 'Page balance integration prerequisites changed; inspect before applying'; end if;
 definition:=replace(definition,old_page,new_page);
 definition:=replace(definition,old_row,new_row);
 definition:=replace(definition,'from chosen join register_source fr on fr.id=chosen.id',
   'from chosen join register_source fr on fr.id=chosen.id left join page_document_balances pb on pb.trip_id=chosen.id');
 execute definition;
end $migration$;
notify pgrst,'reload schema';
