-- Isolated local database only. Synthetic fixtures and requests roll back.
begin;
do $$
declare u uuid:=gen_random_uuid();code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
 c uuid;b uuid;loc uuid;customer uuid;supplier uuid;ar uuid;ap uuid;cost uuid;cash_id uuid;acct uuid;
 trip uuid;trip2 uuid;sales_id uuid;sales2 uuid;rent uuid;rent2 uuid;bill uuid;bill2 uuid;
 result jsonb;again jsonb;payload jsonb;request_id uuid:=gen_random_uuid();payment_id uuid;receipt_id uuid;
 employee uuid;path text; count_before bigint;rejected boolean;other_bu uuid;other_loc uuid;other_c uuid;v numeric;
begin
 insert into auth.users(id,role,email,created_at,updated_at)
 values(u,'authenticated','service-'||code||'@navilo.test',now(),now());
 insert into public.user_profiles(id,user_id,email,role,platform_role,is_active)
 values(u,u,'service-'||code||'@navilo.test','admin','user',true);
 insert into public.companies(name,code,status) values('Service rehearsal','SV'||code,'active') returning id into c;
 select id into strict b from public.business_units where company_id=c and is_default;
 update public.business_units set unit_type='transport' where id=b;
 insert into public.company_memberships(company_id,user_id,role,is_active) values(c,u,'company_owner',true);
 insert into public.business_unit_memberships(company_id,business_unit_id,user_id,role,is_active)
 values(c,b,u,'company_owner',true) on conflict(business_unit_id,user_id) do update set is_active=true;
 insert into public.business_unit_modules(company_id,business_unit_id,module_key,enabled)
  values(c,b,'sales',true),(c,b,'purchase',true),(c,b,'accounting',true),(c,b,'transport',true),(c,b,'settings',true)
 on conflict(business_unit_id,module_key) do update set enabled=true;
 insert into public.operating_locations(company_id,business_unit_id,code,name,location_type,is_active)
 values(c,b,'SV','Service branch','branch',true) returning id into loc;
 insert into public.operating_location_memberships(company_id,business_unit_id,operating_location_id,user_id,role,is_active)
 values(c,b,loc,u,'company_owner',true);
 update public.user_profiles set last_company_id=c,last_business_unit_id=b where id=u;
 perform set_config('request.jwt.claim.sub',u::text,true);
 insert into public.company_settings(user_id,company_id,company_name,strn)
 values(u,c,'Service rehearsal','SERVICE-STRN');
 perform public.initialize_default_coa();
 select account_id into ar from public.account_mappings where company_id=c and mapping_key='accounts_receivable';
 select account_id into ap from public.account_mappings where company_id=c and mapping_key='accounts_payable';
 select account_id into cost from public.account_mappings where company_id=c and mapping_key='cogs';
 select account_id into cash_id from public.account_mappings where company_id=c and mapping_key='cash';
 select id into acct from public.chart_of_accounts where company_id=c and type='expense' and is_active and not is_group
  and id<>cost order by id limit 1;
 if acct is null then acct:=cost; end if;
 if ar is null or ap is null or acct is null or cash_id is null then raise exception 'Canonical accounting setup missing'; end if;
 insert into public.customers(user_id,company_id,name,account_id) values(u,c,'Service Customer',ar) returning id into customer;
 insert into public.suppliers(user_id,company_id,name,account_id) values(u,c,'Service Supplier',ap) returning id into supplier;

 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,sale_type,customer_rate)
 values(c,b,'',current_date,customer,'A','B','credit',1000) returning id into trip;
 result:=public.transport_post_customer_bill(trip,current_date,false);sales_id:=(result->>'document_id')::uuid;
 rent:=public.transport_add_supplier_rent(trip,supplier,600,'Rent');result:=public.transport_post_supplier_bill(rent,current_date,acct,false);bill:=(result->>'document_id')::uuid;
 result:=public.transport_manage_advance(request_id,'customer','record',customer,current_date-1,500,cash_id,'cash',null,null,'ADV-C');receipt_id:=(result->>'journal_entry_id')::uuid;
 again:=public.transport_manage_advance(request_id,'customer','record',customer,current_date-1,500,cash_id,'cash',null,null,'ADV-C');
 if again<>result or (select available from public.transport_party_advances where journal_entry_id=receipt_id)<>500 then raise exception 'Customer advance retry or available amount incorrect';end if;
 if (select sum(amount) from public.transport_canonical_party_movements where side='customer' and party_id=customer)<>500 or (select outstanding_gross from public.transport_service_document_balances where side='customer' and order_id=sales_id)<>1000 then raise exception 'Unallocated customer money incorrectly attributed or AR mismatch';end if;
 request_id:=gen_random_uuid();result:=public.transport_manage_advance(request_id,'customer','allocate',customer,current_date,200,null,'cash',receipt_id,sales_id,'ALLOC-C');
 again:=public.transport_manage_advance(request_id,'customer','allocate',customer,current_date,200,null,'cash',receipt_id,sales_id,'ALLOC-C');
 if again<>result or (select available from public.transport_party_advances where journal_entry_id=receipt_id)<>300 or (select outstanding_gross from public.transport_service_document_balances where side='customer' and order_id=sales_id)<>800 then raise exception 'Partial advance allocation or retry incorrect';end if;
 if exists(select 1 from public.transport_party_movements where order_id=sales_id and event_type='receipt' and event_date<>current_date) then raise exception 'Advance Trip allocation dated as original receipt';end if;
 if (select sum(amount) from public.transport_canonical_party_movements where side='customer' and party_id=customer)<>500 then raise exception 'Advance allocation posted cash again';end if;
 result:=public.transport_manage_advance(gen_random_uuid(),'supplier','record',supplier,current_date-1,400,cash_id,'cash',null,null,'ADV-S');payment_id:=(result->>'journal_entry_id')::uuid;
 if (select available from public.transport_party_advances where journal_entry_id=payment_id)<>400 or (select sum(amount) from public.transport_canonical_party_movements where side='supplier' and party_id=supplier)<>200 then raise exception 'Supplier advance available / canonical AP mismatch';end if;
 result:=public.transport_manage_advance(gen_random_uuid(),'supplier','allocate',supplier,current_date,250,null,'cash',payment_id,bill,'ALLOC-S');
 if (select available from public.transport_party_advances where journal_entry_id=payment_id)<>150 or (select outstanding_gross from public.transport_service_document_balances where side='supplier' and order_id=bill)<>350 then raise exception 'Supplier advance partial Trip allocation incorrect';end if;
 if (select sum(amount) from public.transport_canonical_party_movements where side='supplier' and party_id=supplier)<>200 then raise exception 'Supplier advance allocation posted cash again';end if;
 rejected:=false;begin perform public.transport_manage_advance(gen_random_uuid(),'supplier','allocate',supplier,current_date,151,null,'cash',payment_id,bill,'TOO-MUCH');exception when others then rejected:=true;end;
 if not rejected then raise exception 'Advance over-allocation accepted';end if;
 perform public.transport_adjust_rate(trip,'customer',250,'Decrease after advance',current_date,null,'RATE');
 rejected:=false;begin perform public.transport_manage_advance(gen_random_uuid(),'customer','allocate',customer,current_date,51,null,'cash',receipt_id,sales_id,'CREDIT');exception when others then rejected:=true;end;
 if not rejected then raise exception 'Advance allocation ignored bill credit balance';end if;
 execute 'set local role authenticated';
 if (select sum(available) from public.transport_party_advances)<>450 then raise exception 'Authenticated advances missing or incorrect';end if;
 execute 'reset role';
 perform public.transport_set_financial_permission(u,'settlement',false);
 rejected:=false;begin perform public.transport_manage_advance(gen_random_uuid(),'customer','record',customer,current_date,10,cash_id,'cash',null,null,'DENIED');exception when others then rejected:=true;end;
 if not rejected then raise exception 'Advance permission denial ignored';end if;
 raise notice 'PASS customer/supplier advances, partial later allocation, retry, original cash preserved, dated Trip allocation, credits and permission denial';
end $$;
rollback;
