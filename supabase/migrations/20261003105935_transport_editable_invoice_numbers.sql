-- Optional manual numbers are chosen before canonical posting. No posted renumbering.
create index if not exists transport_sales_number_lookup on public.sales_orders(company_id,lower(btrim(order_no)));
create index if not exists transport_purchase_number_lookup on public.purchase_orders(company_id,lower(btrim(order_no)));
create function public.transport_choose_invoice_number(p_side text,p_number text) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();n text:=nullif(btrim(p_number),'');attempt integer:=0;used boolean;
begin
 if auth.uid() is null or c is null or p_side not in ('customer','supplier') then raise exception 'Authenticated invoice workspace required';end if;
 if n is not null and (length(n)>80 or n ~ '[[:cntrl:]]' or n like '%-AUTO') then raise exception 'Invoice number must be at most 80 characters, without control characters or the reserved -AUTO suffix';end if;
 -- Serializes manual/automatic choices in the same company and invoice side.
 perform pg_advisory_xact_lock(hashtextextended(c::text||':transport-invoice:'||p_side,0));
 loop
  if n is null then n:=public.next_document_number(case when p_side='customer' then 'sales' else 'purchase' end,case when p_side='customer' then 'TR-S' else 'TR-P' end);end if;
  if p_side='customer' then select exists(select 1 from public.sales_orders where company_id=c and lower(btrim(order_no))=lower(n)) into used;
  else select exists(select 1 from public.purchase_orders where company_id=c and lower(btrim(order_no))=lower(n)) into used;end if;
  if not used then return n;end if;
  if nullif(btrim(p_number),'') is not null then raise exception 'Invoice number already exists in this company: %',n;end if;
  n:=null;attempt:=attempt+1;if attempt>1000 then raise exception 'Automatic invoice number range occupied; review numbering settings';end if;
 end loop;
end $$;
revoke all on function public.transport_choose_invoice_number(text,text) from public,anon,authenticated;
create function public.transport_create_numbered_service_document(p_side text,p_party uuid,p_date date,p_amount numeric,
 p_tax boolean,p_cost_account uuid,p_description text,p_reference text, p_invoice_no text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
 u uuid:=public.legacy_data_user_id();base text;tax numeric;oid uuid;j jsonb;number text;
begin
 if p_side not in ('customer','supplier') or p_date is null or coalesce(p_amount,0)<=0 then raise exception 'Valid service document required'; end if;
 perform public.assert_module_permission(case when p_side='customer' then 'sales' else 'purchase' end,'create');
 number:=public.transport_choose_invoice_number(p_side,p_invoice_no);
 select base_currency_code into base from public.companies where id=c;
 tax:=case when p_tax then public.fixed_tax_rate_on(c,case when p_side='customer' then 'sales' else 'purchase' end,p_date) else 0 end;
 if tax is null then raise exception 'Effective fixed VAT rate required'; end if;
 if p_side='customer' then
 insert into public.sales_orders(user_id,company_id,business_unit_id,operating_location_id,order_no,customer_id,
 order_date,status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,payment_mode)
 values(u,c,b,loc,number,p_party,p_date,'draft',case when p_tax then 'Tax Invoice' else 'Sale Invoice' end,tax,base,1,'service','Credit') returning id into oid;
 insert into public.sales_service_lines(company_id,business_unit_id,order_id,description,amount,tax_percent)
 values(c,b,oid,p_description,round(p_amount,2),tax);
 j:=public.post_sales_invoice(oid);
 else
 insert into public.purchase_orders(user_id,company_id,business_unit_id,operating_location_id,order_no,supplier_id,
 order_date,status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,supplier_invoice_no,supplier_invoice_date)
 values(u,c,b,loc,number,p_party,p_date,'draft',case when p_tax then 'Tax Invoice' else 'Purchase Invoice' end,tax,base,1,'service',coalesce(nullif(btrim(p_reference),''),'TR-'||substr(gen_random_uuid()::text,1,12)),p_date) returning id into oid;
 insert into public.purchase_service_lines(company_id,business_unit_id,order_id,description,amount,tax_percent,cost_account_id)
 values(c,b,oid,p_description,round(p_amount,2),tax,p_cost_account);
 j:=public.post_purchase_invoice(oid);
 end if;
 return j||jsonb_build_object('document_id',oid,'invoice_no',number,'net',round(p_amount,2),'vat',round(p_amount*tax/100,2),'tax_percent',tax);
end $$;
revoke all on function public.transport_create_numbered_service_document(text,uuid,date,numeric,boolean,uuid,text,text,text) from public,anon,authenticated;

-- Preserve the existing factory signature for historical imports and adjustments.
create or replace function public.transport_create_service_document(p_side text,p_party uuid,p_date date,p_amount numeric,
 p_tax boolean,p_cost_account uuid,p_description text,p_reference text default null) returns jsonb
language sql security definer set search_path=public,pg_temp as $$
 select public.transport_create_numbered_service_document(p_side,p_party,p_date,p_amount,p_tax,p_cost_account,p_description,p_reference,null)
$$;
revoke all on function public.transport_create_service_document(text,uuid,date,numeric,boolean,uuid,text,text) from public,anon,authenticated;
create or replace function public.transport_post_customer_bill_numbered(p_trip_id uuid,p_date date,p_with_tax boolean default false,p_invoice_no text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype;r jsonb;d uuid;
begin
 perform public.transport_finance_assert('billing');t:=public.transport_financial_trip(p_trip_id);
 if t.sales_order_id is not null then raise exception 'Trip already references a canonical Sales document; reconcile its existing posted linkage before billing';end if;
 if t.sale_type is null or t.customer_id is null or t.customer_rate<=0
 or exists(select 1 from public.transport_customer_document_trips where trip_id=t.id and not is_adjustment)
 then raise exception 'Unbilled Trip, Cash/Credit classification, customer and positive finalized rate required'; end if;
 r:=public.transport_create_numbered_service_document('customer',t.customer_id,p_date,t.customer_rate,p_with_tax,null,
 public.transport_trip_service_description(t.id),null,p_invoice_no);
 insert into public.transport_customer_documents(company_id,business_unit_id,operating_location_id,customer_id,document_kind,sales_order_id,journal_entry_id,created_by)
 values(t.company_id,t.business_unit_id,public.current_operating_location_id(),t.customer_id,
 case when t.sale_type='cash' then 'cash_hand_bill' else 'credit' end,(r->>'document_id')::uuid,(r->>'journal_entry_id')::uuid,auth.uid()) returning id into d;
 insert into public.transport_customer_document_trips(company_id,business_unit_id,document_id,trip_id,rate_snapshot,vat_snapshot)
 values(t.company_id,t.business_unit_id,d,t.id,t.customer_rate,(r->>'vat')::numeric);
 perform public.transport_financial_audit(t.id,'customer_bill_posted',r||jsonb_build_object('transport_document_id',d,'sale_type',t.sale_type));
 return r||jsonb_build_object('transport_document_id',d);
end $$;
revoke all on function public.transport_post_customer_bill_numbered(uuid,date,boolean,text) from public,anon;
grant execute on function public.transport_post_customer_bill_numbered(uuid,date,boolean,text) to authenticated;
create or replace function public.transport_post_supplier_bill_numbered(p_rent_id uuid,p_date date,p_cost_account_id uuid,p_with_tax boolean default false,p_reference text default null,p_invoice_no text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare x public.transport_trip_supplier_rents%rowtype;t public.transport_trips%rowtype;r jsonb;d uuid;
begin
 perform public.transport_finance_assert('rent');
 select * into x from public.transport_trip_supplier_rents where id=p_rent_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() for update;
 if not found then raise exception 'Finalized supplier rent required'; end if;t:=public.transport_financial_trip(x.trip_id);
 if exists(select 1 from public.transport_supplier_document_rents where rent_id=x.id and not is_adjustment) then raise exception 'Supplier rent already billed'; end if;
 r:=public.transport_create_numbered_service_document('supplier',x.supplier_id,p_date,x.amount,p_with_tax,p_cost_account_id,public.transport_trip_service_description(t.id)||' · Supplier rent',p_reference,p_invoice_no);
 insert into public.transport_supplier_documents(company_id,business_unit_id,operating_location_id,supplier_id,purchase_order_id,journal_entry_id,created_by)
 values(x.company_id,x.business_unit_id,public.current_operating_location_id(),x.supplier_id,(r->>'document_id')::uuid,(r->>'journal_entry_id')::uuid,auth.uid()) returning id into d;
 insert into public.transport_supplier_document_rents(company_id,business_unit_id,document_id,rent_id,trip_id,amount_snapshot,vat_snapshot)
 values(x.company_id,x.business_unit_id,d,x.id,t.id,x.amount,(r->>'vat')::numeric);
 perform public.transport_financial_audit(t.id,'supplier_bill_posted',r||jsonb_build_object('rent_id',x.id,'transport_document_id',d));return r;
end $$;
revoke all on function public.transport_post_supplier_bill_numbered(uuid,date,uuid,boolean,text,text) from public,anon;
grant execute on function public.transport_post_supplier_bill_numbered(uuid,date,uuid,boolean,text,text) to authenticated;
create function public.transport_post_cash_bill_receive_numbered(p_request_id uuid,p_trip_id uuid,p_date date,
 p_account_id uuid,p_method text,p_with_tax boolean default false,p_reference text default null,p_invoice_no text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
 t public.transport_trips%rowtype;stored public.transport_cash_sale_requests%rowtype;body jsonb;bill jsonb;receipt jsonb;outcome jsonb;gross numeric;
begin
 perform public.transport_finance_assert('billing');perform public.transport_finance_assert('settlement');
 if p_request_id is null or p_date is null or p_account_id is null or p_method is null or p_method not in ('cash','bank') or loc is null then raise exception 'Request, date, cash/bank account and method required';end if;
 body:=jsonb_build_object('trip',p_trip_id,'date',p_date,'account',p_account_id,'method',p_method,'vat',p_with_tax,'reference',p_reference,'invoice_no',nullif(btrim(p_invoice_no),''));
 insert into public.transport_cash_sale_requests(company_id,business_unit_id,operating_location_id,request_id,created_by,payload)
 values(c,b,loc,p_request_id,auth.uid(),body) on conflict do nothing;
 select * into strict stored from public.transport_cash_sale_requests where company_id=c and business_unit_id=b and operating_location_id=loc and request_id=p_request_id for update;
 if stored.created_by<>auth.uid() or stored.payload<>body then raise exception 'Cash request reused with different actor or payload';end if;
 if stored.result is not null then return stored.result;end if;
 t:=public.transport_financial_trip(p_trip_id);
 if t.sale_type<>'cash' or t.customer_rate_state<>'finalized' then raise exception 'Cash Trip with finalized customer rate required';end if;
 bill:=public.transport_post_customer_bill_numbered(p_trip_id,p_date,p_with_tax,p_invoice_no);
 gross:=(bill->>'net')::numeric+(bill->>'vat')::numeric;
 receipt:=public.transport_settle_reviewed_documents(p_request_id,'customer',t.customer_id,p_date,p_account_id,p_method,
 jsonb_build_array(jsonb_build_object('document_id',(bill->>'document_id')::uuid,'amount',gross)),p_reference);
 outcome:=jsonb_build_object('success',true,'bill',bill,'receipt',receipt,'received_gross',gross);
 update public.transport_cash_sale_requests set result=outcome where company_id=c and business_unit_id=b and operating_location_id=loc and request_id=p_request_id;
 perform public.transport_financial_audit(p_trip_id,'cash_bill_received',outcome);
 return outcome;
end $$;
revoke all on function public.transport_post_cash_bill_receive_numbered(uuid,uuid,date,uuid,text,boolean,text,text) from public,anon;
grant execute on function public.transport_post_cash_bill_receive_numbered(uuid,uuid,date,uuid,text,boolean,text,text) to authenticated;

-- Resolve invoice numbers only for the visible page; preserve all filter/totals logic.
do $$
declare definition text;old_text text:='page as (select row from filtered';new_text text:=$replacement$page as (select row||jsonb_build_object('invoice_no',case when p_side='customer' then
 (select so.order_no from public.transport_customer_document_trips l join public.transport_customer_documents d on d.id=l.document_id join public.sales_orders so on so.id=d.sales_order_id where l.trip_id=(row->>'id')::uuid and not l.is_adjustment order by l.id limit 1)
 else (select po.order_no from public.transport_supplier_document_rents l join public.transport_supplier_documents d on d.id=l.document_id join public.purchase_orders po on po.id=d.purchase_order_id where l.rent_id=(row->'rent'->>'id')::uuid and not l.is_adjustment order by l.id limit 1) end) row from filtered$replacement$;
begin
 definition:=pg_get_functiondef('public.transport_bulk_rate_page(text,integer,integer,jsonb)'::regprocedure);
 if position(old_text in definition)=0 then raise exception 'Unexpected bulk page definition';end if;
 execute replace(definition,old_text,new_text);
end $$;
notify pgrst,'reload schema';
