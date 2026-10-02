create or replace function public.transport_settle_documents(p_side text,p_party_id uuid,p_date date,p_account_id uuid,p_method text,p_allocations jsonb default null::jsonb,p_fifo_amount numeric default null::numeric,p_reference text default null::text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r record;alloc jsonb:=coalesce(p_allocations,'[]');left_amount numeric:=round(p_fifo_amount,2);a numeric;results jsonb:='[]';result jsonb;v_outstanding numeric;
begin
 perform public.transport_finance_assert('settlement');
 if p_side not in ('customer','supplier') then raise exception 'Customer/supplier settlement required'; end if;
 if p_fifo_amount is not null then
  if p_allocations is not null or left_amount<=0 then raise exception 'Choose explicit allocations or positive FIFO amount'; end if;
  if p_side='customer' then perform 1 from public.sales_orders s join public.transport_customer_documents d on d.sales_order_id=s.id where d.customer_id=p_party_id and d.company_id=public.current_company_id() and d.business_unit_id=public.current_business_unit_id() and d.operating_location_id=public.current_operating_location_id() order by s.id for update of s;
  else perform 1 from public.purchase_orders p where supplier_id=p_party_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and operating_location_id=public.current_operating_location_id() and (exists(select 1 from public.transport_supplier_documents where purchase_order_id=p.id) or exists(select 1 from public.transport_service_cost_links where purchase_order_id=p.id)) order by id for update; end if;
  for r in select * from public.transport_service_document_balances where side=p_side and party_id=p_party_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and operating_location_id=public.current_operating_location_id() and outstanding_gross>0 order by order_date,order_no,order_id loop
   a:=least(left_amount,r.outstanding_gross);if a>0 then alloc:=alloc||jsonb_build_array(jsonb_build_object('document_id',r.order_id,'amount',a));left_amount:=left_amount-a;end if;
  end loop;
  if left_amount>0.005 then raise exception 'Amount exceeds outstanding Transport balance; extra payment/receipt is not allowed'; end if;
 end if;
 if jsonb_typeof(alloc)<>'array' or jsonb_array_length(alloc)=0 then raise exception 'At least one document allocation required'; end if;
 for r in select (value->>'document_id')::uuid oid,round(sum((value->>'amount')::numeric),2) amount from jsonb_array_elements(alloc) group by 1 order by 1 loop
  select outstanding_gross into v_outstanding from public.transport_service_document_balances where side=p_side and order_id=r.oid and party_id=p_party_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() and operating_location_id=public.current_operating_location_id();
  if v_outstanding is null or r.amount<=0 then raise exception 'Allocation document outside selected party/workspace'; end if;
  if r.amount>round(v_outstanding,2) then raise exception 'Amount % exceeds outstanding balance %; extra Transport payment/receipt is not allowed',r.amount,round(v_outstanding,2); end if;
  if p_side='customer' then results:=results||jsonb_build_array(jsonb_build_object('sales_order_id',r.oid,'amount',r.amount));
  else result:=public.pay_supplier(p_party_id,p_date,p_account_id,p_method,p_reference,'Transport Supplier Payment',null,r.oid,r.amount);results:=results||jsonb_build_array(result); end if;
 end loop;
 if p_side='customer' then result:=public.receive_customer_payment(p_party_id,p_date,p_account_id,p_method,p_reference,'Transport Customer Receipt',null,results,null::numeric);return result;end if;
 return jsonb_build_object('success',true,'payments',results);
end $$;