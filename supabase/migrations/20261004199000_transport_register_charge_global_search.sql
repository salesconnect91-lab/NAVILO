do $migration$
declare v text;
begin
 select pg_get_functiondef(p.oid) into v from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='transport_register_query'
 and pg_get_function_identity_arguments(p.oid)='p_limit integer, p_offset integer, p_filters jsonb, p_sort text, p_direction text, p_option_key text, p_option_search text';
 if v is null then raise exception 'transport_register_query not found'; end if;

 if position('''charge'',coalesce(nullif((select string_agg(tc.code_snapshot' in v)=0 then
   if position('''to'',coalesce(nullif(r.to_location,''''),''?''),' in v)=0 then raise exception 'Expected register cell block not found'; end if;
   v:=replace(v,
     '''to'',coalesce(nullif(r.to_location,''''),''?''),',
     '''to'',coalesce(nullif(r.to_location,''''),''?''),''charge'',coalesce(nullif((select string_agg(tc.code_snapshot,'' + '' order by tc.sort_order,tc.id) from public.transport_trip_customer_charges tc where tc.trip_id=r.id),''''),''?''),');
 end if;

 if position('concat_ws('' '',x.trip_no,x.po_do_job_no,x.customer_name,x.driver_name,x.vehicle_no,x.from_location,x.to_location,x.vals->''cells''->>''invoice_no'')' in v)>0 then
   v:=replace(v,
     'concat_ws('' '',x.trip_no,x.po_do_job_no,x.customer_name,x.driver_name,x.vehicle_no,x.from_location,x.to_location,x.vals->''cells''->>''invoice_no'')',
     'concat_ws('' '',x.vals->''cells''->>''trip_no'',x.vals->''cells''->>''trip_date'',x.vals->''cells''->>''truck_type'',x.vals->''cells''->>''job_no'',x.vals->''cells''->>''invoiced'',x.vals->''cells''->>''company'',x.vals->''cells''->>''driver'',x.vals->''cells''->>''owner'',x.vals->''cells''->>''plate'',x.vals->''cells''->>''from'',x.vals->''cells''->>''to'',x.vals->''cells''->>''charge'',x.vals->''cells''->>''paper_received_by'',x.vals->''cells''->>''rent_driver'',x.vals->''cells''->>''supplier_paid'',x.vals->''cells''->>''supplier_balance'',x.vals->''cells''->>''supplier_credit'',x.vals->''cells''->>''driver_pay'',x.vals->''cells''->>''driver_paid'',x.vals->''cells''->>''driver_balance'',x.vals->''cells''->>''payment_date'',x.vals->''cells''->>''amount'',x.vals->''cells''->>''company_rate'',x.vals->''cells''->>''received_company'',x.vals->''cells''->>''remaining_company'',x.vals->''cells''->>''customer_credit'',x.vals->''cells''->>''profit'',x.vals->''cells''->>''commission'',x.vals->''cells''->>''invoice_no'',x.vals->''cells''->>''sale_type'',x.status,x.financial_status,x.ppr_status)');
 elsif position('x.vals->''cells''->>''charge''' in v)=0 then
   raise exception 'Expected register global-search block not found';
 end if;
 execute v;
end $migration$;

notify pgrst,'reload schema';
