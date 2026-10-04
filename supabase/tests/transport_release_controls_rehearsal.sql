-- Isolated local database only. Synthetic fixtures and requests roll back.
begin;
do $$
declare u uuid:=gen_random_uuid();code text:=substr(replace(gen_random_uuid()::text,'-',''),1,12);
 c uuid;b uuid;loc uuid;from_loc uuid;to_loc uuid;customer uuid;supplier uuid;ar uuid;ap uuid;cost uuid;cash_id uuid;acct uuid;
 trip uuid;trip2 uuid;sales_id uuid;sales2 uuid;rent uuid;rent2 uuid;bill uuid;bill2 uuid;
 result jsonb;again jsonb;payload jsonb;request_id uuid:=gen_random_uuid();payment_id uuid;receipt_id uuid;
 count_before bigint;rejected boolean;other_bu uuid;other_loc uuid;other_c uuid;v numeric;
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

 insert into public.transport_locations(company_id,business_unit_id,name,is_active) values(c,b,'A',true) returning id into from_loc;
 insert into public.transport_locations(company_id,business_unit_id,name,is_active) values(c,b,'B',true) returning id into to_loc;

 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,from_location_id,to_location_id,customer_rate,owner_rent,sale_type)
 values(c,b,'',current_date,customer,'A','B',from_loc,to_loc,1000,400,'credit') returning id into trip;
 insert into public.transport_trips(company_id,business_unit_id,trip_no,trip_date,customer_id,from_location,to_location,from_location_id,to_location_id,customer_rate,owner_rent,sale_type)
 values(c,b,'',current_date,customer,'A','B',from_loc,to_loc,1000,300,'credit') returning id into trip2;
 -- Direct posting must fail before approval on EVERY exposed numbering/description route.
 select count(*) into count_before from public.journal_entries;
 rejected:=false;begin perform public.transport_post_customer_bill(trip,current_date,false);exception when others then rejected:=sqlerrm like '%finalized%';end;
 if not rejected then raise exception 'Pending customer direct posting bypass';end if;
 rejected:=false;begin perform public.transport_post_customer_bill_numbered(trip,current_date,false,'PENDING');exception when others then rejected:=sqlerrm like '%finalized%';end;
 if not rejected then raise exception 'Pending numbered customer posting bypass';end if;
 rejected:=false;begin perform public.transport_post_customer_bill_described(trip,current_date,false,'PENDING','Description');exception when others then rejected:=sqlerrm like '%finalized%';end;
 if not rejected then raise exception 'Pending described customer posting bypass';end if;
 if (select count(*) from public.journal_entries)<>count_before then raise exception 'Rejected posting left journal';end if;
 rent:=public.transport_add_supplier_rent(trip,supplier,400,'Approved proposal');
 rejected:=false;begin perform public.transport_post_supplier_bill(rent,current_date,acct,false);exception when others then rejected:=sqlerrm like '%finalized%';end;
 if not rejected then raise exception 'Pending supplier posting bypass';end if;
 rejected:=false;begin perform public.transport_post_supplier_bill_numbered(rent,current_date,acct,false,null,'PENDING');exception when others then rejected:=sqlerrm like '%finalized%';end;
 if not rejected then raise exception 'Pending numbered supplier posting bypass';end if;
 rejected:=false;begin perform public.transport_post_supplier_bill_described(rent,current_date,acct,false,null,'PENDING','Description');exception when others then rejected:=sqlerrm like '%finalized%';end;
 if not rejected then raise exception 'Pending described supplier posting bypass';end if;
 perform public.transport_finalize_customer_rate(trip,1000,'manual');
 perform public.transport_finalize_supplier_rent(rent,400);
 if exists(select 1 from public.transport_customer_document_trips where trip_id=trip) or exists(select 1 from public.transport_supplier_document_rents where rent_id=rent) then raise exception 'Finalize-only posted';end if;
 select count(*) into count_before from public.transport_trip_audit where trip_id=trip;
 perform public.transport_finalize_customer_rate(trip,1000,'manual','No-op authorized override');
 perform public.transport_finalize_supplier_rent(rent,400,'No-op authorized correction');
 if (select count(*) from public.transport_trip_audit where trip_id=trip)<>count_before then raise exception 'True no-op created audit';end if;
 execute 'set local role authenticated';
 result:=public.transport_post_cost_request(request_id,trip,'other',supplier,25,current_date,acct,false,'Same intent');
 again:=public.transport_post_cost_request(request_id,trip,'other',supplier,25,current_date,acct,false,'Same intent');
 if result is distinct from again or (select count(*) from public.transport_service_cost_links where trip_id=trip)<>1 then raise exception 'Cost retry duplicated financial evidence';end if;
 rejected:=false;begin perform public.transport_post_cost_request(request_id,trip,'other',supplier,26,current_date,acct,false,'Same intent');exception when others then rejected:=sqlerrm like '%mismatch%';end;
 if not rejected then raise exception 'Changed intent payload accepted';end if;
 again:=public.transport_post_cost_request(gen_random_uuid(),trip,'other',supplier,25,current_date,acct,false,'Same intent');
 if result->>'document_id'=again->>'document_id' or (select count(*) from public.transport_service_cost_links where trip_id=trip)<>2 then raise exception 'Distinct equal-value intents merged';end if;
 rejected:=false;begin perform public.transport_post_cost(trip,'other',supplier,25,current_date,acct,false);exception when insufficient_privilege then rejected:=true;end;
 if not rejected then raise exception 'Unprotected cost signature exposed';end if;
 insert into public.transport_vehicles(company_id,business_unit_id,vehicle_no) values(c,b,'ACL-'||code);
 execute 'reset role';
 result:=public.transport_post_customer_bill(trip,current_date,false);
 result:=public.transport_post_supplier_bill(rent,current_date,acct,false);
 result:=public.transport_party_report_query('documents','customer',jsonb_build_object('party',customer));
 if jsonb_array_length(result)<>1 or result->0->>'side'<>'customer' then raise exception 'Selected side/party reader failed';end if;
 if public.transport_party_report_query('documents','customer',jsonb_build_object('party',gen_random_uuid()))<>'[]'::jsonb then raise exception 'Party filter ignored';end if;
 if public.transport_party_report_query('documents','customer',jsonb_build_object('to',current_date-1))<>'[]'::jsonb then raise exception 'As-of filter ignored';end if;
 result:=public.transport_document_trip_detail_query('customer',jsonb_build_object('party',customer));
 if jsonb_array_length(result)<>1 or result->0->>'trip_no' is null then raise exception 'Filtered document Trip details missing';end if;
 if public.transport_document_trip_detail_query('customer',jsonb_build_object('party',gen_random_uuid()))<>'[]'::jsonb then raise exception 'Document Trip party filter ignored';end if;
 if has_function_privilege('authenticated','public._transport_mask_financial_row(jsonb,boolean,boolean)','execute') or has_function_privilege('anon','public._transport_mask_financial_row(jsonb,boolean,boolean)','execute') then raise exception 'Private cached-capability mask is exposed';end if;
 -- Customer-only: operational rows + own financial data; no opposite raw/table/RPC/totals.
 update public.business_unit_memberships set permissions='{"transport_actions":{"customer_finance_view":true,"supplier_finance_view":false}}' where business_unit_id=b and user_id=u;
 execute 'set local role authenticated';
 result:=public.transport_register_query();
 if jsonb_array_length(result->'rows')<>2 or result->'rows'->0 ? 'supplier_rent' or result->'totals' ? 'rent_driver' or not result->'totals' ? 'company_rate' then raise exception 'Customer-only register masking failed: %',result;end if;
 if exists(select 1 from public.transport_trips) or exists(select 1 from public.transport_trip_supplier_rents) then raise exception 'Customer-only raw financial bypass';end if;
 rejected:=false;begin perform public.transport_bulk_rate_page('supplier');exception when others then rejected:=true;end;
 if not rejected then raise exception 'Supplier bulk read leaked';end if;
 rejected:=false;begin perform public.transport_trip_audit_report((result->'rows'->0->>'trip_no'));exception when others then rejected:=true;end;
 if not rejected then raise exception 'Raw financial audit leaked';end if;
 execute 'reset role';
 update public.business_unit_memberships set permissions='{"transport_actions":{"customer_finance_view":false,"supplier_finance_view":true}}' where business_unit_id=b and user_id=u;
 execute 'set local role authenticated';result:=public.transport_register_query();
 if result->'rows'->0 ? 'customer_rate' or result->'totals' ? 'company_rate' or not result->'totals' ? 'rent_driver' then raise exception 'Supplier-only register masking failed';end if;
 execute 'reset role';
 update public.business_unit_memberships set permissions='{"transport_actions":{"customer_finance_view":false,"supplier_finance_view":false}}' where business_unit_id=b and user_id=u;
 execute 'set local role authenticated';result:=public.transport_register_query();
 if jsonb_array_length(result->'rows')<>2 or result->'totals' <> '{}'::jsonb then raise exception 'Operational-only financial leak';end if;
 result:=public.transport_edit_trip_read(trip);
 if result ? 'customer_rate' or result ? 'owner_rent' or result ? 'supplier_rent_total' then raise exception 'Operational detail financial leak';end if;
 perform public.transport_update_operational_trip(trip,'{"po_do_job_no":"OPERATIONS"}');
 execute 'reset role';
 update public.business_unit_memberships set permissions='{}' where business_unit_id=b and user_id=u;
 update public.business_unit_modules set enabled=false where business_unit_id=b and module_key='transport';
 if public.has_module_permission(c,'transport','view') or public.transport_finance_allowed('billing') or public.transport_financial_read_allowed('customer') then raise exception 'Disabled BU module allowed';end if;
 update public.business_unit_modules set enabled=true where business_unit_id=b and module_key='transport';
 if exists(select 1 from public.transport_trip_audit where trip_id=trip and source is null) then raise exception 'New audit source missing';end if;
 raise notice 'Release controls PASS: pending/alternate posting, finalize-only/no-op, cost intent retries, fresh master ACL, masked/direct reads, operational edits and disabled module';
end $$;
rollback;
