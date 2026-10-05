-- Forward-only compatibility fix for customer-side Transport charges.
-- Sales charge rows are recoveries; Charge Master applies_to remains the workflow applicability source.
create or replace function public.transport_create_charged_service_document(
 p_side text,p_party uuid,p_date date,p_base_amount numeric,p_tax boolean,p_cost_account uuid,p_description text,p_reference text,p_invoice_no text,p_trip_id uuid,p_rent_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $body$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();u uuid:=public.legacy_data_user_id();
 base text;tax numeric;oid uuid;j jsonb;number text;charge_total numeric:=0;charge_vat numeric:=0;x record;
begin
 if p_side not in ('customer','supplier') or p_date is null or coalesce(p_base_amount,0)<0 then raise exception 'Valid service document required';end if;
 perform public.assert_module_permission(case when p_side='customer' then 'sales' else 'purchase' end,'create');
 number:=public.transport_choose_invoice_number(p_side,p_invoice_no);
 select base_currency_code into base from public.companies where id=c;
 tax:=case when p_tax then public.fixed_tax_rate_on(c,case when p_side='customer' then 'sales' else 'purchase' end,p_date) else 0 end;
 if tax is null then raise exception 'Effective fixed VAT rate required';end if;
 if p_side='customer' then
  insert into public.sales_orders(user_id,company_id,business_unit_id,operating_location_id,order_no,customer_id,order_date,status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,payment_mode)
  values(u,c,b,loc,number,p_party,p_date,'draft',case when p_tax then 'Tax Invoice' else 'Sale Invoice' end,tax,base,1,'service','Credit') returning id into oid;
  if p_base_amount>0 then insert into public.sales_service_lines(company_id,business_unit_id,order_id,description,amount,tax_percent,source_module,source_id,created_by)
   values(c,b,oid,p_description,round(p_base_amount,2),tax,'transport',p_trip_id,auth.uid());end if;
  for x in select tc.amount,cm.* from public.transport_trip_customer_charges tc join public.charge_master cm on cm.id=tc.charge_master_id
   where tc.trip_id=p_trip_id and cm.company_id=c and cm.is_active and cm.applies_to in ('sales','both') order by tc.sort_order,tc.id loop
   if x.revenue_account_id is null then raise exception 'Charge % has no revenue account mapping',x.charge_name;end if;
   insert into public.sales_order_charges(order_id,charge_key,charge_label,amount,tax_percent,account_id,charge_type,cost_amount,cost_account_id,company_id,business_unit_id,quantity,rate)
   values(oid,x.charge_key,x.charge_name,x.amount,case when p_tax and x.tax_applicable then tax else 0 end,x.revenue_account_id,'recovery',0,x.cost_account_id,c,b,1,x.amount);
   charge_total:=charge_total+x.amount;charge_vat:=charge_vat+case when p_tax and x.tax_applicable then round(x.amount*tax/100,2) else 0 end;
  end loop;
  j:=public.post_sales_invoice(oid);
 else
  insert into public.purchase_orders(user_id,company_id,business_unit_id,operating_location_id,order_no,supplier_id,order_date,status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,supplier_invoice_no,supplier_invoice_date)
  values(u,c,b,loc,number,p_party,p_date,'draft',case when p_tax then 'Tax Invoice' else 'Purchase Invoice' end,tax,base,1,'service',coalesce(nullif(btrim(p_reference),''),'TR-'||substr(gen_random_uuid()::text,1,12)),p_date) returning id into oid;
  if p_base_amount>0 then insert into public.purchase_service_lines(company_id,business_unit_id,order_id,description,amount,tax_percent,cost_account_id,source_module,source_id,created_by)
   values(c,b,oid,p_description,round(p_base_amount,2),tax,p_cost_account,'transport',p_trip_id,auth.uid());end if;
  for x in select sc.amount,cm.* from public.transport_trip_supplier_charges sc join public.charge_master cm on cm.id=sc.charge_master_id
   where sc.trip_id=p_trip_id and sc.rent_id=p_rent_id and cm.company_id=c and cm.is_active and cm.applies_to in ('purchase','both') order by sc.sort_order,sc.id loop
   if x.cost_account_id is null then raise exception 'Charge % has no cost account mapping',x.charge_name;end if;
   insert into public.purchase_order_charges(user_id,company_id,business_unit_id,order_id,charge_key,charge_label,amount,tax_percent,treatment,cost_account_id,quantity,rate)
   values(u,c,b,oid,x.charge_key,x.charge_name,x.amount,case when p_tax and x.tax_applicable then tax else 0 end,coalesce(x.purchase_treatment,'expense'),x.cost_account_id,1,x.amount);
   charge_total:=charge_total+x.amount;charge_vat:=charge_vat+case when p_tax and x.tax_applicable then round(x.amount*tax/100,2) else 0 end;
  end loop;
  j:=public.post_purchase_invoice(oid);
 end if;
 return j||jsonb_build_object('document_id',oid,'invoice_no',number,'base_net',round(p_base_amount,2),'charges_net',round(charge_total,2),'net',round(p_base_amount+charge_total,2),'vat',round(p_base_amount*tax/100,2)+charge_vat,'tax_percent',tax);
end$body$;
