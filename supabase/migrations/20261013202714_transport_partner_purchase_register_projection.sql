-- Hide partner supplier-payment cells without editing Trips, Sales or raw source evidence.
begin;
do $patch$ declare f text;cols text;begin
 f:=regexp_replace(pg_get_viewdef('public.transport_historical_payment_effective'::regclass,true),';\s*$','');
 select string_agg(case when a.attname in('paid_gross','supplier_remaining_effective') then format('case when e.supplier_id is not null then 0::numeric else src.%I end as %I',a.attname,a.attname)
 when a.attname in('payment_date','opening_supplier_document_id') then format('case when e.supplier_id is not null then null::%s else src.%I end as %I',format_type(a.atttypid,a.atttypmod),a.attname,a.attname)
 else format('src.%I',a.attname) end,',' order by a.attnum) into cols from pg_attribute a where a.attrelid='public.transport_historical_payment_effective'::regclass and a.attnum>0 and not a.attisdropped;
 execute 'create or replace view public.transport_historical_payment_effective with(security_invoker=true) as select '||cols||' from ('||f||') src join public.transport_trips pt on pt.id=src.trip_id left join public.transport_partner_purchase_exclusions e on e.company_id=src.company_id and e.business_unit_id=src.business_unit_id and e.operating_location_id=src.operating_location_id and e.supplier_id=pt.owner_supplier_id';
 -- The old opening balance remains immutable evidence for partner migration,
 -- and is no longer offered as a second supplier Purchase/payment target.
 f:=regexp_replace(pg_get_viewdef('public.transport_opening_invoice_balances'::regclass,true),';\s*$','');
 execute 'create or replace view public.transport_opening_invoice_balances with(security_invoker=true) as select src.* from ('||f||') src where not exists(select 1 from public.transport_partner_purchase_exclusions e where src.side=''supplier'' and e.company_id=src.company_id and e.business_unit_id=src.business_unit_id and e.operating_location_id=src.operating_location_id and e.supplier_id=src.party_id)';
end $patch$;
notify pgrst,'reload schema';
commit;
