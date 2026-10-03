begin;
-- Reporting is read-only. Active invoices define side-specific posting; immutable
-- rate locks deliberately retain their separate historical/correction meaning.
create function public.transport_trip_report(p_side text default 'customer',p_limit integer default 500,p_offset integer default 0,p_filters jsonb default '{}')
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();answer jsonb;
begin
 if auth.uid() is null or c is null or b is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission and active workspace required';end if;
 if p_side is null or p_side not in ('customer','supplier') or jsonb_typeof(p_filters) is distinct from 'object' or octet_length(p_filters::text)>10000 then raise exception 'Invalid report filters';end if;
 if coalesce(p_filters->>'posting','posted') not in ('posted','unposted','all') then raise exception 'Invalid posting filter';end if;
 with base as materialized (
 select r.*,o.owner_type ownership_class,
 exists(select 1 from public.transport_customer_document_trips l join public.transport_customer_documents d on d.id=l.document_id join public.transport_active_journals j on j.id=d.journal_entry_id where l.trip_id=r.id and d.operating_location_id=public.current_operating_location_id()) customer_posted,
 exists(select 1 from public.transport_supplier_document_rents l join public.transport_supplier_documents d on d.id=l.document_id join public.transport_active_journals j on j.id=d.journal_entry_id where l.trip_id=r.id and d.operating_location_id=public.current_operating_location_id()) supplier_posted,
 coalesce((select sum(x.amount) from public.transport_trip_supplier_rents x where x.trip_id=r.id),r.supplier_rent,r.owner_rent,0) agreed_supplier_rent
 from public.transport_financial_register r left join public.transport_vehicle_ownership o on o.id=r.ownership_id and o.company_id=c and o.business_unit_id=b
 where r.company_id=c and r.business_unit_id=b
 and (coalesce(p_filters->>'from','')='' or r.trip_date>=(p_filters->>'from')::date)
 and (coalesce(p_filters->>'to','')='' or r.trip_date<=(p_filters->>'to')::date)
 and (coalesce(p_filters->>'account','')='' or (p_filters->>'accountKind'='vehicle' and exists(select 1 from public.transport_trip_assignments a where a.trip_id=r.id and a.vehicle_id::text=p_filters->>'account')) or (p_filters->>'accountKind'='driver' and exists(select 1 from public.transport_drivers d where d.id=r.driver_id and d.employee_id::text=p_filters->>'account')))
 and (coalesce(p_filters->>'party','')='' or (p_side='customer' and r.customer_id::text=p_filters->>'party') or (p_side='supplier' and exists(select 1 from public.transport_trip_supplier_rents rent where rent.trip_id=r.id and rent.supplier_id::text=p_filters->>'party')))
 and (coalesce(p_filters->>'search','')='' or position(lower(btrim(p_filters->>'search')) in lower(concat_ws(' ',r.trip_no,r.customer_name,r.owner_name,r.driver_name,r.vehicle_no,r.from_location,r.to_location,r.po_do_job_no)))>0)
 ), filtered as materialized (
 select * from base where coalesce(p_filters->>'posting','posted')='all'
 or (case when p_side='customer' then customer_posted else supplier_posted end)= (coalesce(p_filters->>'posting','posted')='posted')
 ), page as(select * from filtered order by trip_date desc,trip_no desc,id limit greatest(1,least(coalesce(p_limit,500),500)) offset greatest(coalesce(p_offset,0),0))
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'),'count',(select count(*) from filtered),
 'summary',(select jsonb_build_object('revenue',coalesce(sum(billed_customer_net),0),'cost',coalesce(sum(coalesce(billed_supplier_net,0)+coalesce(driver_accrued,0)+coalesce(other_cost_net,0)),0),'profit',coalesce(sum(coalesce(billed_customer_net,0)-coalesce(billed_supplier_net,0)-coalesce(driver_accrued,0)-coalesce(other_cost_net,0)),0)) from filtered)) into answer;
 return answer;
end $$;
revoke all on function public.transport_trip_report(text,integer,integer,jsonb) from public,anon;
grant execute on function public.transport_trip_report(text,integer,integer,jsonb) to authenticated;

-- Existing private idempotency store; no new accounting tables or posting engine.
create function public.transport_driver_charge_upload(p_request_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();h text;old public.transport_cost_upload_requests;x jsonb;result jsonb;
begin
 perform public.transport_finance_assert('driver');
 if p_request_id is null or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Upload 1–500 reviewed charges';end if;
 if (select count(distinct item->>'trip_id') from jsonb_array_elements(p_rows) item)<>jsonb_array_length(p_rows) then raise exception 'Duplicate Trip charge';end if;
 h:=md5(jsonb_build_object('kind','agreed_driver_charge','rows',p_rows)::text);
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into old from public.transport_cost_upload_requests where request_id=p_request_id;
 if found then
 if old.company_id is distinct from c or old.business_unit_id is distinct from b or old.operating_location_id is distinct from public.current_operating_location_id() or old.payload_hash<>h then raise exception 'Upload request mismatch';end if;return old.result;end if;
 for x in select * from jsonb_array_elements(p_rows) loop
 if x->>'amount' is null or x->>'amount' !~ '^[0-9]+(\.[0-9]{1,2})?$' or (x->>'amount')::numeric<0 or (x->>'amount')::numeric<>round((x->>'amount')::numeric,2) then raise exception 'Nonnegative two-decimal driver charge required';end if;
 perform public.transport_set_driver_pay((x->>'trip_id')::uuid,(x->>'amount')::numeric,x->>'reason');
 end loop;
 result:=jsonb_build_object('saved',jsonb_array_length(p_rows));
 insert into public.transport_cost_upload_requests(request_id,company_id,business_unit_id,operating_location_id,payload_hash,result,created_by) values(p_request_id,c,b,public.current_operating_location_id(),h,result,auth.uid());return result;
end $$;
revoke all on function public.transport_driver_charge_upload(uuid,jsonb) from public,anon;
grant execute on function public.transport_driver_charge_upload(uuid,jsonb) to authenticated;

create function public.transport_reviewed_cost_upload(p_request_id uuid,p_rows jsonb,p_supplier_id uuid,p_cost_account_id uuid,p_kind text,p_with_tax boolean default false)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();h text;old public.transport_cost_upload_requests;x jsonb;result jsonb:='[]';
begin
 perform public.transport_finance_assert('cost');
 if p_request_id is null or p_kind not in ('driver_expense','vehicle_expense','commission','other') or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Upload 1–500 reviewed cost rows and valid kind';end if;
 h:=md5(jsonb_build_object('kind',p_kind,'rows',p_rows,'supplier',p_supplier_id,'account',p_cost_account_id,'tax',p_with_tax)::text);
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));select * into old from public.transport_cost_upload_requests where request_id=p_request_id;
 if found then
 if old.company_id is distinct from c or old.business_unit_id is distinct from b or old.operating_location_id is distinct from public.current_operating_location_id() or old.payload_hash<>h then raise exception 'Upload request mismatch';end if;return old.result;end if;
 for x in select * from jsonb_array_elements(p_rows) loop
 if (x->>'amount') is null or x->>'amount' !~ '^[0-9]+(\.[0-9]{1,2})?$' or (x->>'amount')::numeric<=0 or (x->>'amount')::numeric<>round((x->>'amount')::numeric,2) then raise exception 'Positive two-decimal expense required';end if;
 result:=result||jsonb_build_array(public.transport_post_cost((x->>'trip_id')::uuid,p_kind,p_supplier_id,(x->>'amount')::numeric,(x->>'date')::date,p_cost_account_id,p_with_tax,x->>'reference'));
 end loop;
 insert into public.transport_cost_upload_requests(request_id,company_id,business_unit_id,operating_location_id,payload_hash,result,created_by) values(p_request_id,c,b,public.current_operating_location_id(),h,result,auth.uid());return result;
end $$;
revoke all on function public.transport_reviewed_cost_upload(uuid,jsonb,uuid,uuid,text,boolean) from public,anon;
grant execute on function public.transport_reviewed_cost_upload(uuid,jsonb,uuid,uuid,text,boolean) to authenticated;

-- Aggregate canonical ledger through its existing RLS. Keep opening and period
-- movements separate, and exclude year-end closures only for historical P&L.
create function public.accounting_report_balances(p_from date,p_to date,p_exclude_closing boolean default false)
returns jsonb language plpgsql security invoker stable set search_path=public,pg_temp as $$
declare answer jsonb;
begin
 if auth.uid() is null or not public.has_module_permission(public.current_company_id(),'accounting','view') then raise exception 'Accounting view permission required';end if;
 if p_to is null or (p_from is not null and p_from>p_to) then raise exception 'Valid report dates required';end if;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (
 select l.account_id,case when p_from is not null and l.entry_date<p_from then p_from-1 else coalesce(p_from,p_to) end entry_date,sum(l.debit) debit,sum(l.credit) credit
 from public.ledgers l join public.journal_entries j on j.id=l.journal_entry_id
 where l.entry_date<=p_to and j.status='posted'
 and (not p_exclude_closing or ((p_from is null or l.entry_date>=p_from) and j.trans_type is distinct from 'Year End Closing' and j.fiscal_year_closure_id is null))
 group by l.account_id,case when p_from is not null and l.entry_date<p_from then p_from-1 else coalesce(p_from,p_to) end
 ) q;return answer;
end $$;
revoke all on function public.accounting_report_balances(date,date,boolean) from public,anon;
grant execute on function public.accounting_report_balances(date,date,boolean) to authenticated;
create function public.transport_contribution_summary(p_from date,p_to date)
returns jsonb language plpgsql security invoker stable set search_path=public,pg_temp as $$
declare answer jsonb;
begin
 if auth.uid() is null or not public.has_module_permission(public.current_company_id(),'transport','view') then raise exception 'Transport view permission required';end if;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (
 select coalesce(o.owner_type,'unattributed') ownership,count(distinct v.trip_id) trips,sum(v.revenue) revenue,sum(v.cost) cost,sum(v.revenue-v.cost) profit
 from public.transport_vehicle_contributions v join public.transport_trips t on t.id=v.trip_id
 left join public.transport_vehicle_ownership o on o.vehicle_id=v.account_id and o.company_id=v.company_id and o.business_unit_id=v.business_unit_id and o.effective_from<=t.trip_date and (o.effective_to is null or t.trip_date<=o.effective_to)
 where (p_from is null or v.event_date>=p_from) and (p_to is null or v.event_date<=p_to)
 group by coalesce(o.owner_type,'unattributed')
 ) q;return answer;
end $$;
revoke all on function public.transport_contribution_summary(date,date) from public,anon;
grant execute on function public.transport_contribution_summary(date,date) to authenticated;

-- Service invoices carry trip details, keeping the canonical VAT/posting engine.
create function public.transport_trip_service_description(p_trip_id uuid) returns text
language sql security invoker stable set search_path=public,pg_temp as $$
 select concat_ws(' · ','Transport service',t.trip_no,to_char(t.trip_date,'DD-Mon-YYYY'),t.from_location||' → '||t.to_location,
 'Vehicle: '||coalesce(v.vehicle_no,'Unassigned'),'Driver: '||coalesce(d.driver_name,'Unassigned'),'Job/PO/DO: '||nullif(t.po_do_job_no,''))
 from public.transport_trips t left join public.transport_vehicles v on v.id=t.vehicle_id left join public.transport_drivers d on d.id=t.driver_id where t.id=p_trip_id
$$;
revoke all on function public.transport_trip_service_description(uuid) from public,anon;
grant execute on function public.transport_trip_service_description(uuid) to authenticated;
create or replace function public.transport_post_customer_bill(p_trip_id uuid,p_date date,p_with_tax boolean default false) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.transport_trips%rowtype;r jsonb;d uuid;
begin
 perform public.transport_finance_assert('billing');t:=public.transport_financial_trip(p_trip_id);
 if t.sales_order_id is not null then raise exception 'Trip already references a canonical Sales document; reconcile its existing posted linkage before billing';end if;
 if t.sale_type is null or t.customer_id is null or t.customer_rate<=0
 or exists(select 1 from public.transport_customer_document_trips where trip_id=t.id and not is_adjustment)
 then raise exception 'Unbilled Trip, Cash/Credit classification, customer and positive finalized rate required'; end if;
 r:=public.transport_create_service_document('customer',t.customer_id,p_date,t.customer_rate,p_with_tax,null,
 public.transport_trip_service_description(t.id));
 insert into public.transport_customer_documents(company_id,business_unit_id,operating_location_id,customer_id,document_kind,sales_order_id,journal_entry_id,created_by)
 values(t.company_id,t.business_unit_id,public.current_operating_location_id(),t.customer_id,
 case when t.sale_type='cash' then 'cash_hand_bill' else 'credit' end,(r->>'document_id')::uuid,(r->>'journal_entry_id')::uuid,auth.uid()) returning id into d;
 insert into public.transport_customer_document_trips(company_id,business_unit_id,document_id,trip_id,rate_snapshot,vat_snapshot)
 values(t.company_id,t.business_unit_id,d,t.id,t.customer_rate,(r->>'vat')::numeric);
 perform public.transport_financial_audit(t.id,'customer_bill_posted',r||jsonb_build_object('transport_document_id',d,'sale_type',t.sale_type));
 return r||jsonb_build_object('transport_document_id',d);
end $$;
revoke all on function public.transport_post_customer_bill(uuid,date,boolean) from public,anon;
grant execute on function public.transport_post_customer_bill(uuid,date,boolean) to authenticated;
create or replace function public.transport_post_supplier_bill(p_rent_id uuid,p_date date,p_cost_account_id uuid,p_with_tax boolean default false,p_reference text default null) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare x public.transport_trip_supplier_rents%rowtype;t public.transport_trips%rowtype;r jsonb;d uuid;
begin
 perform public.transport_finance_assert('rent');
 select * into x from public.transport_trip_supplier_rents where id=p_rent_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() for update;
 if not found then raise exception 'Finalized supplier rent required'; end if;t:=public.transport_financial_trip(x.trip_id);
 if exists(select 1 from public.transport_supplier_document_rents where rent_id=x.id and not is_adjustment) then raise exception 'Supplier rent already billed'; end if;
 r:=public.transport_create_service_document('supplier',x.supplier_id,p_date,x.amount,p_with_tax,p_cost_account_id,public.transport_trip_service_description(t.id)||' · Supplier rent',p_reference);
 insert into public.transport_supplier_documents(company_id,business_unit_id,operating_location_id,supplier_id,purchase_order_id,journal_entry_id,created_by)
 values(x.company_id,x.business_unit_id,public.current_operating_location_id(),x.supplier_id,(r->>'document_id')::uuid,(r->>'journal_entry_id')::uuid,auth.uid()) returning id into d;
 insert into public.transport_supplier_document_rents(company_id,business_unit_id,document_id,rent_id,trip_id,amount_snapshot,vat_snapshot)
 values(x.company_id,x.business_unit_id,d,x.id,t.id,x.amount,(r->>'vat')::numeric);
 perform public.transport_financial_audit(t.id,'supplier_bill_posted',r||jsonb_build_object('rent_id',x.id,'transport_document_id',d));return r;
end $$;
revoke all on function public.transport_post_supplier_bill(uuid,date,uuid,boolean,text) from public,anon;
grant execute on function public.transport_post_supplier_bill(uuid,date,uuid,boolean,text) to authenticated;
create function public.transport_document_trip_details(p_side text,p_order_id uuid default null,p_limit integer default 1000,p_offset integer default 0)
returns jsonb language plpgsql security definer stable set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();answer jsonb;
begin
 if auth.uid() is null or c is null or b is null or loc is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view and active branch required';end if;
 if p_side is null or p_side not in ('customer','supplier') then raise exception 'Invalid document side';end if;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into answer from (
 select src.order_id,src.order_no,t.id trip_id,t.trip_no,t.trip_date,t.from_location,t.to_location,t.po_do_job_no,
 a.vehicle_no_snapshot vehicle_no,a.driver_name_snapshot driver_name,a.owner_name_snapshot owner_name,
 coalesce(a.vehicle_no_snapshot,'Unattributed') attribution_vehicle
 from public.transport_party_document_sources src join public.transport_trips t on t.id=any(src.trip_ids)
 join public.journal_entries j on j.id=src.journal_entry_id
 left join lateral(select * from public.transport_trip_assignments a where a.trip_id=t.id and a.created_at<=j.created_at and a.effective_at<=j.created_at and (a.ended_at is null or j.created_at<a.ended_at) order by a.effective_at desc limit 1) a on true
 where src.company_id=c and src.business_unit_id=b and src.operating_location_id=loc and src.side=p_side
 and (p_order_id is null or src.order_id=p_order_id)
 order by src.order_id,t.id limit greatest(1,least(p_limit,1000)) offset greatest(p_offset,0)
 ) q;return answer;
end $$;
revoke all on function public.transport_document_trip_details(text,uuid,integer,integer) from public,anon;
grant execute on function public.transport_document_trip_details(text,uuid,integer,integer) to authenticated;
commit;
