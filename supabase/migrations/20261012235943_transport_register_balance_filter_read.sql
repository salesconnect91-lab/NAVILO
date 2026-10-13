begin;
do $balance$
declare d text;e text;anchor text;
begin
 d:=pg_get_functiondef('public.transport_register_query(integer,integer,jsonb,text,text,text,text)'::regprocedure);
 d:=replace(d,E'and coalesce(jsonb_array_length(p_filters->''statuses''),0)=0\n and not exists(select 1 from jsonb_each(coalesce(p_filters->''columns'',''{}'')) x where jsonb_array_length(x.value)>0)',E'and not exists(select 1 from jsonb_each(coalesce(p_filters->''columns'',''{}'')) x where jsonb_array_length(x.value)>0 and x.key not in (''trip_no'',''trip_date'',''payment_date'',''company_rate'',''received_company'',''remaining_company'',''customer_credit'',''rent_driver'',''supplier_paid'',''supplier_balance'',''supplier_credit'',''driver_pay'',''driver_paid'',''driver_balance'',''amount'',''profit'',''commission'',''charge'',''supplier_charges''))');
 d:=replace(d,'''fromDate'',''toDate'',''customer'',''driver'',''vehicle'',''from'',''to'',''ppr''','''customer'',''driver'',''vehicle'',''from'',''to''');
 e:=$number$case f.key
 when 'company_rate' then x.rate when 'received_company' then x.historical_received
 when 'remaining_company' then greatest(x.historical_customer_remaining,0) when 'customer_credit' then greatest(-x.historical_customer_remaining,0)
 when 'rent_driver' then x.rent when 'supplier_paid' then x.historical_paid
 when 'supplier_balance' then greatest(x.historical_supplier_remaining,0) when 'supplier_credit' then greatest(-x.historical_supplier_remaining,0)
 when 'driver_pay' then x.driver_agreed when 'driver_balance' then x.driver_agreed when 'amount' then x.historical_paid
 when 'profit' then x.rate-x.rent-x.driver_agreed else 0 end$number$;
 anchor:='), selected as materialized (';
 if position(anchor in d)=0 then raise exception 'Unexpected fast balance page';end if;
 d:=replace(d,anchor,'), matched as materialized (select * from base x where
 (coalesce(p_filters->>''fromDate'','''')='''' or x.trip_date>=(p_filters->>''fromDate'')::date)
 and (coalesce(p_filters->>''toDate'','''')='''' or x.trip_date<=(p_filters->>''toDate'')::date)
 and (coalesce(p_filters->>''ppr'','''')='''' or x.ppr_status=p_filters->>''ppr'')
 and not exists(select 1 from jsonb_each(coalesce(p_filters->''columns'',''{}'')) f where jsonb_array_length(f.value)>0 and not f.value @> jsonb_build_array(case f.key
 when ''trip_no'' then coalesce(nullif(x.trip_no,''''),''?'')
 when ''trip_date'' then coalesce(nullif(to_char(x.trip_date,''DD-Mon-YY''),''''),''?'')
 when ''payment_date'' then coalesce(nullif(to_char(x.historical_payment_date,''DD-Mon-YY''),''''),''?'')
 else to_char(('||e||'),''FM999,999,999,999,999,990.00'') end))
 ), filtered_base as materialized (select * from matched x where coalesce(jsonb_array_length(p_filters->''statuses''),0)=0 or exists(select 1 from jsonb_array_elements_text(p_filters->''statuses'') s where s=''status:''||x.status)), selected as materialized (');
 d:=replace(d,'from base x order by','from filtered_base x order by');
 d:=replace(d,'totals from base','totals from filtered_base');
 d:=replace(d,'left join base x on','left join matched x on');
 d:=replace(d,'count(*) filter(where status=''complete'') completed','count(*) filter(where status in (''complete'',''locked'',''settled'')) completed');
 execute d;
end $balance$;
notify pgrst,'reload schema';
commit;
