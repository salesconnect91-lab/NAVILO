-- Resolve a blank same-company legacy Customer AR inside the invoice transaction.
-- The canonical journal guard still requires the exact valid mapped AR. Explicit wrong accounts fail.
do $$
declare definition text;old_guard text:='and user_id=o.user_id and account_id=v_ar;';
begin
 definition:=pg_get_functiondef('public.post_service_sales_invoice_core(uuid)'::regprocedure);
 if position(old_guard in definition)=0 then raise exception 'Unexpected service Sales mapping guard';end if;
 execute replace(definition,'select name into v_customer from public.customers',
 'update public.customers set account_id=v_ar where id=o.customer_id and company_id=o.company_id and user_id=o.user_id and account_id is null;
 select name into v_customer from public.customers');
end $$;
-- Search input is trimmed. Numeric header filters accept both 1,900 and 1900.
do $$
declare definition text;old_filter text:=$old$where f.value<>'' and position(lower(btrim(f.value)) in lower(coalesce(x.cell_values->>f.key,'')))=0$old$;
 new_filter text:=$new$where btrim(f.value)<>'' and position(
 lower(case when f.key in ('rate','rent') then replace(btrim(f.value),',','') else regexp_replace(btrim(f.value),'[[:space:]]*(→|->)[[:space:]]*',' ','g') end)
 in lower(case when f.key in ('rate','rent') then replace(coalesce(x.cell_values->>f.key,''),',','') else regexp_replace(coalesce(x.cell_values->>f.key,''),'[[:space:]]*(→|->)[[:space:]]*',' ','g') end))=0$new$;
begin
 definition:=pg_get_functiondef('public.transport_bulk_rate_page(text,integer,integer,jsonb)'::regprocedure);
 if position(old_filter in definition)=0 then raise exception 'Unexpected bulk header filter definition';end if;
 definition:=replace(definition,old_filter,new_filter);
 definition:=replace(definition,$anchor$lower(p_filters->>'search')$anchor$,$anchor$lower(btrim(p_filters->>'search'))$anchor$);
 -- SQL literals use quoted strings, not identifiers.
 execute definition;
end $$;
-- Numeric register dropdown searches accept raw and formatted amounts.
do $$
declare definition text;anchor text:=$old$position(lower(coalesce(p_option_search,'')) in lower(x.vals->'cells'->>p_option_key))>0$old$;
begin
 definition:=pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
 if position(anchor in definition)=0 then raise exception 'Unexpected register option search';end if;
 execute replace(definition,anchor,$new$position(
 lower(case when x.vals->'numbers' ? p_option_key then replace(btrim(coalesce(p_option_search,'')),',','') else btrim(coalesce(p_option_search,'')) end)
 in lower(case when x.vals->'numbers' ? p_option_key then replace(x.vals->'cells'->>p_option_key,',','') else x.vals->'cells'->>p_option_key end))>0$new$);
end $$;
-- Each amount total covers the whole filtered data, independent of its 500-row page.
do $$
declare definition text;anchor text:=$old$'summary',(select jsonb_build_object('revenue',$old$;
begin
 definition:=pg_get_functiondef('public.transport_trip_report(text,integer,integer,jsonb)'::regprocedure);
 if position(anchor in definition)=0 then raise exception 'Unexpected Trip report summary';end if;
 definition:=replace(definition,$old$r.to_location,r.po_do_job_no)))$old$,$new$r.to_location,r.po_do_job_no,
 (select string_agg(so.order_no,' ') from public.transport_customer_document_trips l join public.transport_customer_documents d on d.id=l.document_id join public.sales_orders so on so.id=d.sales_order_id where l.trip_id=r.id),
 (select string_agg(po.order_no,' ') from public.transport_supplier_document_rents l join public.transport_supplier_documents d on d.id=l.document_id join public.purchase_orders po on po.id=d.purchase_order_id where l.trip_id=r.id))))$new$);
 execute replace(definition,anchor,$new$'summary',(select jsonb_build_object('customer_rate',coalesce(sum(customer_rate),0),'agreed_supplier_rent',coalesce(sum(agreed_supplier_rent),0),'driver_pay',coalesce(sum(driver_pay),0),'billed_customer_net',coalesce(sum(billed_customer_net),0),'billed_supplier_net',coalesce(sum(billed_supplier_net),0),'driver_accrued',coalesce(sum(driver_accrued),0),'other_cost_net',coalesce(sum(other_cost_net),0),'customer_received_gross',coalesce(sum(customer_received_gross),0),'customer_outstanding_gross',coalesce(sum(customer_outstanding_gross),0),'customer_credit_gross',coalesce(sum(customer_credit_gross),0),'supplier_paid_gross',coalesce(sum(payment_amount),0),'supplier_outstanding_gross',coalesce(sum(supplier_outstanding_gross),0),'supplier_credit_gross',coalesce(sum(supplier_credit_gross),0),'driver_paid',coalesce(sum(driver_paid),0),'driver_outstanding',coalesce(sum(driver_outstanding),0),'revenue',$new$);
end $$;
notify pgrst,'reload schema';
