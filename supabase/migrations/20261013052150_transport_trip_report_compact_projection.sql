-- Carry only displayed/filter financial facts through the full-book report CTEs.
-- The report is not an operational edit DTO; immutable source totals remain separate.
do $compact$ declare body text;projection text; begin
 select pg_get_functiondef('public.transport_trip_report(text,integer,integer,jsonb)'::regprocedure) into body;
 if position('select r.*,o.owner_type ownership_class,' in body)=0 then raise exception 'Unexpected Trip report projection';end if;
 projection:='select r.id,r.company_id,r.business_unit_id,r.trip_no,r.trip_date,r.customer_name,r.owner_name,r.vehicle_no,r.driver_name,r.from_location,r.to_location,r.po_do_job_no,r.truck_type_name,r.truck_type,r.notes,r.customer_rate,r.driver_pay,r.billed_customer_net,r.billed_supplier_net,r.driver_accrued,r.other_cost_net,r.customer_received_gross,r.customer_outstanding_gross,r.customer_credit_gross,r.payment_amount,r.supplier_outstanding_gross,r.supplier_credit_gross,r.driver_paid,r.driver_outstanding,o.owner_type ownership_class,';
 body:=replace(body,'select r.*,o.owner_type ownership_class,',projection);
 body:=replace(body,'with register_source as materialized (','with register_source as not materialized (');
 execute body;
end $compact$;
notify pgrst,'reload schema';
