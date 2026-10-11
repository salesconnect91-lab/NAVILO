-- Isolated fixture, real canonical AR/AP/VAT posting, rolled back.
begin;
do $$
declare u uuid:=gen_random_uuid();c uuid;b uuid;loc uuid;customer uuid;supplier uuid;supplier2 uuid;
 cash_id uuid;acct uuid;cost uuid;ar uuid;ap uuid;code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
 revenue uuid;cm uuid;trip uuid;trip2 uuid;draft_trip uuid;rent uuid;sale uuid;purchase uuid;group_sale uuid;group_purchase uuid;single_sale uuid;single_purchase uuid;result jsonb;v numeric;before_order jsonb;before_trip jsonb;blocked boolean;trip_no_saved text;audit_count integer;charge_type uuid;vehicle uuid;external_order uuid;external_line uuid;
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

 insert into public.suppliers(user_id,company_id,name,account_id) values(u,c,'Second Supplier',ap) returning id into supplier2;

 select id into revenue from public.chart_of_accounts where company_id=c and type='revenue' and is_active and not is_group order by id limit 1;
 update public.account_mappings set account_id=revenue where company_id=c and mapping_key='service_revenue';
 update public.customers set strn='CUSTOMER-VAT' where id=customer;
 update public.suppliers set strn='SUPPLIER-VAT' where id=supplier;
 insert into public.tax_rates(user_id,company_id,name,rate,is_active,is_fixed,applies_to,effective_from,effective_to)
 values(u,c,'VAT 15',15,true,true,'both','2020-01-01','2026-12-31'),(u,c,'VAT 18',18,true,true,'both','2027-01-01',null);
 perform public.transport_set_party_billing_mode('customer',customer,'Credit');
 perform public.transport_set_party_billing_mode('supplier',supplier,'Cash');

 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 values(c,b,'','2026-10-11',customer,'A','B',1000,0,'credit') returning id,trip_no into trip,trip_no_saved;
 insert into public.transport_trip_supplier_rents(company_id,business_unit_id,trip_id,supplier_id,supplier_name_snapshot,amount,state,source,created_by,reason)
 values(c,b,trip,supplier,'Service Supplier',400,'pending','spot',u,'Draft fixture') returning id into rent;
 insert into public.transport_charge_types(company_id,business_unit_id,code,name,created_by) values(c,b,'W','Waiting',u) returning id into charge_type;
 insert into public.transport_trip_customer_charges(company_id,business_unit_id,trip_id,charge_type_id,code_snapshot,name_snapshot,amount,created_by) values(c,b,trip,charge_type,'W','Waiting',100,u);
 insert into public.transport_trip_locations(company_id,business_unit_id,trip_id,location_name_snapshot,sequence_no,created_by)
 values(c,b,trip,'A',1,u);
 insert into public.transport_action_gate values(txid_current(),trip,'assignment_initial');
 insert into public.transport_trip_assignments(company_id,business_unit_id,trip_id,effective_at,actor_id) values(c,b,trip,now(),u);
 delete from public.transport_action_gate where trip_id=trip and action='assignment_initial';
 select count(*) into audit_count from public.transport_trip_audit where trip_id=trip;
 blocked:=false;begin delete from public.transport_trips where id=trip;exception when others then blocked:=true;end;
 if not blocked then raise exception 'Direct Trip delete was allowed';end if;
 blocked:=false;begin perform public.transport_delete_draft_trip(trip,'  ');exception when others then blocked:=true;end;
 if not blocked then raise exception 'Empty reason allowed';end if;
 update public.business_unit_memberships set permissions=jsonb_build_object('transport_actions',jsonb_build_object('trip_delete',false)) where business_unit_id=b and user_id=u;
 blocked:=false;begin perform public.transport_delete_draft_trip(trip,'Denied');exception when others then blocked:=true;end;
 if not blocked then raise exception 'Explicit permission denial bypassed';end if;
 update public.business_unit_memberships set permissions='{}' where business_unit_id=b and user_id=u;
 blocked:=false;begin perform public.transport_delete_draft_trip(gen_random_uuid(),'Other workspace');exception when others then blocked:=true;end;
 if not blocked then raise exception 'Unknown Trip allowed';end if;
 -- Use the actual authenticated role, exercising execution grants and guards.
 set local role authenticated;
 blocked:=false;begin insert into public.transport_action_gate values(txid_current(),trip,'trip_delete');exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Authenticated user forged delete gate';end if;
 result:=public.transport_delete_draft_trip(trip,'Created twice by mistake');
 reset role;
 if not (result->>'deleted')::boolean or exists(select 1 from public.transport_trips where id=trip) then raise exception 'Draft Trip not deleted';end if;
 if exists(select 1 from public.transport_trip_customer_charges where trip_id=trip) or exists(select 1 from public.transport_trip_supplier_rents where trip_id=trip) or exists(select 1 from public.transport_trip_locations where trip_id=trip) or exists(select 1 from public.transport_trip_assignments where trip_id=trip) then raise exception 'Draft children not cleaned';end if;
 if not exists(select 1 from public.transport_trip_audit where trip_no=trip_no_saved and event_type='delete' and reason='Created twice by mistake' and actor_id=u and old_data->>'id'=trip::text and old_data->'deleted_supplier_rents'->0->>'id'=rent::text and trip_id is null) then raise exception 'Deletion audit snapshot missing';end if;
 if (select count(*) from public.transport_trip_audit where trip_no=trip_no_saved)<audit_count+1 then raise exception 'Prior audit history lost';end if;
 if exists(select 1 from public.transport_action_gate where trip_id=trip) then raise exception 'Delete gate leaked';end if;
 blocked:=false;begin update public.transport_trip_audit set reason='Tampered' where trip_no=trip_no_saved;exception when others then blocked:=true;end;
 if not blocked then raise exception 'Deleted audit not immutable';end if;
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 values(c,b,'','2026-10-11',customer,'A','B',1000,0,'credit') returning id into trip2;
 if (select trip_no from public.transport_trips where id=trip2)=trip_no_saved then raise exception 'Trip number reused';end if;
 perform public.transport_finalize_customer_rate(trip2,1000,'manual','Finalized rate fixture');
 blocked:=false;begin perform public.transport_delete_draft_trip(trip2,'Wrong status');exception when others then blocked:=true;end;
 if not blocked then raise exception 'Non Draft deleted';end if;
 insert into public.sales_orders(user_id,company_id,business_unit_id,operating_location_id,order_no,customer_id,order_date,status,invoice_type,tax_percent,currency_code,exchange_rate,document_kind,payment_mode)
 values(u,c,b,loc,'DEL-S-'||code,customer,'2026-10-11','draft','Sale Invoice',0,(select base_currency_code from public.companies where id=c),1,'service','Cash') returning id into sale;
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,customer_rate,owner_rent,sale_type)
 values(c,b,'','2026-10-11',customer,'A','B',1000,0,'credit') returning id into draft_trip;
 update public.transport_trips set sales_order_id=sale where id=draft_trip;
 blocked:=false;begin perform public.transport_delete_draft_trip(draft_trip,'Has document');exception when others then blocked:=true;end;
 if not blocked or not exists(select 1 from public.transport_trips where id=draft_trip) then raise exception 'Financial document Trip deleted';end if;
end $$;
rollback;
