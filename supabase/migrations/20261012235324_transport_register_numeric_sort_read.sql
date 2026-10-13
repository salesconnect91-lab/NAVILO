begin;
do $sort$
declare d text;sort_expr text;anchor text;
begin
 d:=pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
 if position('coalesce(p_sort,'''') in ('''',''trip_date'')' in d)=0 then raise exception 'Unexpected fast sort guard';end if;
 d:=replace(d,'coalesce(p_sort,'''') in ('''',''trip_date'')','coalesce(p_sort,'''') in ('''',''trip_date'',''trip_no'',''payment_date'',''company_rate'',''received_company'',''remaining_company'',''customer_credit'',''rent_driver'',''supplier_paid'',''supplier_balance'',''supplier_credit'',''driver_pay'',''driver_paid'',''driver_balance'',''amount'',''profit'',''commission'',''charge'',''supplier_charges'')');
 sort_expr:=$number$case p_sort
 when 'trip_no' then case when x.trip_no ~ '^[0-9]+$' then x.trip_no::numeric end
 when 'company_rate' then x.rate when 'received_company' then x.historical_received
 when 'remaining_company' then greatest(x.historical_customer_remaining,0) when 'customer_credit' then greatest(-x.historical_customer_remaining,0)
 when 'rent_driver' then x.rent when 'supplier_paid' then x.historical_paid
 when 'supplier_balance' then greatest(x.historical_supplier_remaining,0) when 'supplier_credit' then greatest(-x.historical_supplier_remaining,0)
 when 'driver_pay' then x.driver_agreed when 'driver_balance' then x.driver_agreed when 'amount' then x.historical_paid
 when 'profit' then x.rate-x.rent-x.driver_agreed
 when 'driver_paid' then 0 when 'commission' then 0 when 'charge' then 0 when 'supplier_charges' then 0 end$number$;
 anchor:='order by case when p_sort=''trip_date'' and p_direction=''asc'' then x.trip_date end asc,';
 if position(anchor in d)=0 then raise exception 'Unexpected fast page sort';end if;
 d:=replace(d,anchor,'order by case when p_direction=''asc'' then ('||sort_expr||') end asc, case when p_direction=''desc'' then ('||sort_expr||') end desc, case when p_sort=''payment_date'' and p_direction=''asc'' then x.historical_payment_date end asc, case when p_sort=''payment_date'' and p_direction=''desc'' then x.historical_payment_date end desc, case when p_sort=''trip_no'' and x.trip_no !~ ''^[0-9]+$'' and p_direction=''asc'' then x.trip_no end asc, case when p_sort=''trip_no'' and x.trip_no !~ ''^[0-9]+$'' and p_direction=''desc'' then x.trip_no end desc, case when p_sort=''trip_date'' and p_direction=''asc'' then x.trip_date end asc,');
 d:=replace(d,'needs_cells boolean;','needs_cells boolean;needs_text_cells boolean;');
 anchor:=E' with register_source as not materialized';
 if position(anchor in d)=0 then raise exception 'Unexpected compact filter query';end if;
 d:=replace(d,anchor,E' needs_text_cells:=needs_cells and not (p_option_key is null and coalesce(p_filters->>''snapshot'',''false'')<>''true'' and btrim(coalesce(p_filters->>''search'',''''))='''' and not exists(select 1 from jsonb_each(coalesce(p_filters->''columns'',''{}'')) f where jsonb_array_length(f.value)>0) and p_sort=any(array[''company_rate'',''received_company'',''remaining_company'',''customer_credit'',''rent_driver'',''supplier_paid'',''supplier_balance'',''supplier_credit'',''driver_pay'',''driver_paid'',''driver_balance'',''amount'',''profit'',''commission'',''charge'',''supplier_charges'']));\n with register_source as not materialized');
 d:=replace(d,'''cells'',case when needs_cells then','''cells'',case when needs_text_cells then');
 execute d;
end $sort$;
notify pgrst,'reload schema';
commit;
