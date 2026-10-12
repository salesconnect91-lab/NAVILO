begin;
create or replace function public._transport_linked_register_source(p_company uuid,p_unit uuid,p_location uuid)
returns setof public.transport_financial_register language plpgsql stable security invoker rows 20000
set search_path=public,pg_temp set work_mem='64MB' as $source$
declare row_id uuid;
begin
 if exists(select 1 from public.transport_opening_invoice_documents where company_id=p_company and business_unit_id=p_unit and operating_location_id=p_location) then
  return query select * from public._transport_opening_register_rows(p_company,p_unit,p_location);
  for row_id in
   with financial_ids as materialized (
    select trip_id from public.transport_customer_document_trips union select trip_id from public.transport_supplier_document_rents
    union select trip_id from public.transport_driver_accrual_attributions union select trip_id from public.transport_driver_payment_attributions
    union select trip_id from public.transport_service_cost_links
   ), opening_ids as materialized (
    select distinct l.trip_id from public.transport_opening_invoice_lines l join public.transport_opening_invoice_documents d on d.id=l.document_id
    where d.company_id=p_company and d.business_unit_id=p_unit and d.operating_location_id=p_location
   )
   select t.id from public.transport_trips t left join opening_ids o on o.trip_id=t.id left join financial_ids f on f.trip_id=t.id
    where t.company_id=p_company and t.business_unit_id=p_unit and t.operating_location_id=p_location
     and (o.trip_id is null or f.trip_id is not null or t.sales_order_id is not null)
  loop
   return query select fr.* from public.transport_financial_register fr where fr.id=row_id;
  end loop;
 else
  return query select fr.* from public.transport_financial_register fr join public.transport_trips t on t.id=fr.id
   where t.company_id=p_company and t.business_unit_id=p_unit and t.operating_location_id=p_location;
 end if;
end $source$;
revoke all on function public._transport_linked_register_source(uuid,uuid,uuid) from public,anon,authenticated;

do $sets$
declare d text;at integer;guard text;
begin
 select prosrc into d from pg_proc where oid='public._transport_opening_register_rows(uuid,uuid,uuid)'::regprocedure;
 at:=position('and not (t.sales_order_id is not null' in d);if at=0 then raise exception 'Unexpected native Trip eligibility';end if;
 d:='with financial_ids as materialized (select trip_id from public.transport_customer_document_trips union select trip_id from public.transport_supplier_document_rents union select trip_id from public.transport_driver_accrual_attributions union select trip_id from public.transport_driver_payment_attributions union select trip_id from public.transport_service_cost_links) '||substring(d from 1 for at-1)||'and t.sales_order_id is null and not exists(select 1 from financial_ids f where f.trip_id=t.id)';
 execute 'create or replace function public._transport_opening_register_rows(uuid,uuid,uuid) returns setof public.transport_financial_register language sql stable security invoker rows 20000 set search_path=public,pg_temp as '||quote_literal(d);
 revoke all on function public._transport_opening_register_rows(uuid,uuid,uuid) from public,anon,authenticated;

 -- The internal source enforces all three workspace IDs before returning any
 -- row. Reapplying those filters to an opaque set-returning function led to a
 -- one-row estimate and repeated scans of the supplier aggregate.
 d:=pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
 guard:='and fr.company_id=c and fr.business_unit_id=b and exists(select 1 from public.transport_trips bt where bt.id=fr.id and bt.operating_location_id=loc)';
 if position(guard in d)=0 then raise exception 'Unexpected scoped source filters';end if;
 d:=replace(d,'from register_source fr where cv and sv '||guard,'from register_source fr where cv and sv');
 d:=replace(d,'masked where not (cv and sv) '||guard,'masked where not (cv and sv)');
 d:=replace(d,E'where r.company_id=c and r.business_unit_id=b\n   and (coalesce(p_filters',E'where true\n   and (coalesce(p_filters');
 execute d;

 -- Original Trip labels are already available on the joined immutable source
 -- identity row. Avoid a second per-Trip identity lookup for every report page.
 d:=pg_get_viewdef('public.transport_opening_invoice_balances'::regclass,true);
 d:=replace(d,'transport_display_trip_no(t.id, t.trip_no)','COALESCE(NULLIF(h.source_trip_id, ''''), t.trip_no)');
 execute 'create or replace view public.transport_opening_invoice_balances with(security_invoker=true) as '||d;
 d:=pg_get_functiondef('public.transport_opening_invoice_query(text,text,jsonb,integer,integer)'::regprocedure);
 d:=replace(d,'public.transport_display_trip_no(t.id,t.trip_no)','coalesce(nullif(h.source_trip_id,''''),t.trip_no)');
 execute d;
end $sets$;
notify pgrst,'reload schema';
commit;
