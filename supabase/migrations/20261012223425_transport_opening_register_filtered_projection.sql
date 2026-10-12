-- Read-only projection for imported Trips; native financial Trips retain the
-- original reader. The current view definition supplies its exact column order.
begin;
do $projection$
declare v text;d text;original text;native text;
begin
 v:=pg_get_viewdef('public.transport_financial_register'::regclass,true);
 original:='JOIN transport_trip_financial_summary f ON f.id = t.id';
 if position(original in v)=0 then raise exception 'Unexpected Register financial projection';end if;
 v:=replace(v,original,$replacement$CROSS JOIN LATERAL (
  select 0::bigint customer_documents,false customer_rate_locked,false supplier_rate_locked,
   0::numeric customer_net,0::numeric customer_received_net,0::numeric customer_outstanding_net,
   0::numeric customer_received_gross,0::numeric customer_outstanding_gross,0::numeric customer_credit_gross,
   0::numeric supplier_net,0::numeric supplier_paid_net,0::numeric supplier_outstanding_gross,0::numeric supplier_credit_gross,
   0::numeric driver_accrued,0::numeric driver_paid,greatest(t.driver_pay,0) driver_outstanding,
   null::date supplier_payment_date,0::numeric supplier_paid_gross,null::numeric posted_profit,
   0::numeric commission_paid_net,0::numeric other_cost_net,
   case when t.status='cancelled' then 'Cancelled' when t.status='draft' then 'Draft'
    when t.customer_rate>0 and (t.owner_rent>0 or exists(select 1 from public.transport_trip_supplier_rents r where r.trip_id=t.id)) then 'Complete' else 'Not Complete' end financial_status
 ) f$replacement$);
 native:=$native$t.sales_order_id is not null
  or exists(select 1 from public.transport_customer_document_trips n where n.trip_id=t.id)
  or exists(select 1 from public.transport_supplier_document_rents n where n.trip_id=t.id)
  or exists(select 1 from public.transport_driver_accrual_attributions n where n.trip_id=t.id)
  or exists(select 1 from public.transport_driver_payment_attributions n where n.trip_id=t.id)
  or exists(select 1 from public.transport_service_cost_links n where n.trip_id=t.id)$native$;
 v:=regexp_replace(v,';[[:space:]]*$','')||' where t.company_id=$1 and t.business_unit_id=$2 and t.operating_location_id=$3 and exists(select 1 from public.transport_opening_invoice_lines ol where ol.trip_id=t.id) and not ('||native||')';
 execute 'create or replace function public._transport_opening_register_rows(uuid,uuid,uuid) returns setof public.transport_financial_register language sql stable security invoker set search_path=public,pg_temp as '||quote_literal(v);
 revoke all on function public._transport_opening_register_rows(uuid,uuid,uuid) from public,anon,authenticated;

 d:=pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
 if position('opening_read boolean' in d)>0 then raise exception 'Opening projection already installed';end if;
 if position('answer jsonb;needs_cells boolean;' in d)=0 or position('with agreed_rents as materialized (' in d)=0 then raise exception 'Unexpected Register body';end if;
 d:=replace(d,'answer jsonb;needs_cells boolean;','answer jsonb;opening_read boolean;needs_cells boolean;');
 d:=replace(d,' -- Unposted operational filter values',E' opening_read:=exists(select 1 from public.transport_opening_invoice_documents where company_id=c and business_unit_id=b and operating_location_id=loc);\n -- Unposted operational filter values');
 d:=replace(d,'if cv and sv and p_option_key is null','if not opening_read and cv and sv and p_option_key is null');
 d:=replace(d,'from public.transport_financial_register fr where cv','from register_source fr where cv');
 d:=replace(d,'from public.transport_financial_register fr cross join','from register_source fr cross join');
 d:=replace(d,'with agreed_rents as materialized (',
 'with native_trip_ids as materialized (select t.id from public.transport_trips t where opening_read and t.company_id=c and t.business_unit_id=b and t.operating_location_id=loc and (not exists(select 1 from public.transport_opening_invoice_lines ol where ol.trip_id=t.id) or '||native||')), register_source as materialized (
  select r.* from public._transport_opening_register_rows(c,b,loc) r where opening_read
  union all
  select r.* from native_trip_ids n cross join lateral (select fr.* from public.transport_financial_register fr where fr.id=n.id offset 0) r
  union all
  select fr.* from public.transport_financial_register fr where not opening_read and fr.company_id=c and fr.business_unit_id=b and fr.operating_location_id=loc
 ), agreed_rents as materialized (');
 -- The composite view may not expose operating_location_id. The original
 -- authoritative scope uses the physical Trip row for that dimension.
 d:=replace(d,'fr.operating_location_id=loc','exists(select 1 from public.transport_trips scoped_trip where scoped_trip.id=fr.id and scoped_trip.operating_location_id=loc)');
 execute d;
end $projection$;
notify pgrst,'reload schema';
commit;
