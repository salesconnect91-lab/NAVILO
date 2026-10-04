-- Forward release controls. Never renumber Trips or infer historical financial evidence.
begin;


-- Deny direct RPC access when the active BU lacks membership or module entitlement.
create or replace function public.has_module_permission(p_company_id uuid,p_module text,p_action text)
returns boolean
language plpgsql stable security definer
set search_path=public,pg_temp
as $$
declare
  v_role text;
  v_permissions jsonb;
  v_override jsonb;
  v_action text:=coalesce(nullif(p_action,''),'view');
  v_bu uuid:=public.current_business_unit_id();
begin
  if p_company_id is null or p_company_id<>public.current_company_id() then return false; end if;
  if not public.company_module_enabled(p_company_id,p_module) and p_module<>'dashboard' then return false; end if;
  if public.is_platform_owner() then return true; end if;
  if not public.has_company_access(p_company_id) then return false; end if;
  if v_bu is null and p_module<>'dashboard' then return false; end if;
  if v_bu is not null and not exists (
    select 1 from public.business_unit_modules bum
    join public.business_units bu on bu.id=bum.business_unit_id
    where bum.company_id=p_company_id and bum.business_unit_id=v_bu
      and bu.company_id=p_company_id and bu.is_active
      and bum.module_key=p_module and bum.enabled
  ) and p_module<>'dashboard' then return false; end if;

  if v_bu is not null then
    select bm.role,bm.permissions into v_role,v_permissions
    from public.business_unit_memberships bm
    join public.business_units bu on bu.id=bm.business_unit_id and bu.company_id=bm.company_id and bu.is_active
    where bm.company_id=p_company_id and bm.business_unit_id=v_bu and bm.user_id=auth.uid() and bm.is_active limit 1;
  end if;
  if v_bu is not null and v_role is null then return false; end if;
  if v_role is null then
    select cm.role,cm.permissions into v_role,v_permissions from public.company_memberships cm
    where cm.company_id=p_company_id and cm.user_id=auth.uid() and cm.is_active limit 1;
  end if;
  if v_role is null then return false; end if;
  v_override:=v_permissions#>array[p_module,v_action];
  if v_override is not null then return (v_override#>>'{}')::boolean; end if;
  if v_role in ('company_owner','admin') then return true; end if;

  if v_action in ('view','print','export') then
    return case v_role
      when 'accounts' then p_module in ('dashboard','accounting','reports','master')
      when 'sales' then p_module in ('dashboard','sales','reports','master','inventory')
      when 'purchase' then p_module in ('dashboard','purchase','reports','master','inventory')
      when 'store' then p_module in ('dashboard','inventory','reports','master')
      when 'production' then p_module in ('dashboard','production','inventory','reports','master')
      when 'transport' then p_module in ('dashboard','transport','accounting','reports','master','settings')
      when 'viewer' then p_module in ('dashboard','reports')
      else false end;
  end if;
  if v_action='delete' then return false; end if;
  if v_action in ('create','edit','post') then
    return case v_role
      when 'accounts' then p_module='accounting'
      when 'sales' then p_module='sales'
      when 'purchase' then p_module='purchase'
      when 'store' then p_module='inventory'
      when 'production' then p_module='production'
      when 'transport' then p_module='transport'
      else false end;
  end if;
  return false;
end$$;
revoke all on function public.has_module_permission(uuid,text,text) from public,anon;
grant execute on function public.has_module_permission(uuid,text,text) to authenticated,service_role;


CREATE OR REPLACE FUNCTION public.transport_finance_allowed(p_action text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();v boolean;r text;
begin
 if auth.uid() is null or c is null or b is null then return false; end if;
 if p_action not in ('billing','rent','settlement','driver','cost','adjustment','close') then return false; end if;
 if not public.has_module_permission(c,'transport','view') or not public.has_module_permission(c,'transport','post') then return false; end if;
 select allowed into v from public.transport_financial_permissions where company_id=c and business_unit_id=b and user_id=auth.uid() and action=p_action;
 if found then return v; end if;
 select role into r from public.business_unit_memberships where company_id=c and business_unit_id=b and user_id=auth.uid() and is_active limit 1;
 if r in ('company_owner','admin') then return true; end if;
 return public.has_module_permission(c,'transport','post');
end $function$
;

CREATE OR REPLACE FUNCTION public.transport_post_customer_bill(p_trip_id uuid, p_date date, p_with_tax boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.transport_trips%rowtype;r jsonb;d uuid;
begin
 perform public.transport_finance_assert('billing');t:=public.transport_financial_trip(p_trip_id);
 if t.customer_rate_state is distinct from 'finalized' or t.customer_rate_snapshot is null or t.customer_rate_snapshot is distinct from t.customer_rate then raise exception 'Consistent finalized customer rate snapshot required';end if;
 if t.sales_order_id is not null then raise exception 'Trip already references a canonical Sales document; reconcile its existing posted linkage before billing';end if;
 if t.sale_type is null or t.customer_id is null or t.customer_rate<=0
 or exists(select 1 from public.transport_customer_document_trips where trip_id=t.id and not is_adjustment)
 then raise exception 'Unbilled Trip, Cash/Credit classification, customer and positive finalized rate required'; end if;
 r:=public.transport_create_service_document('customer',t.customer_id,p_date,t.customer_rate_snapshot,p_with_tax,null,
 public.transport_trip_service_description(t.id));
 insert into public.transport_customer_documents(company_id,business_unit_id,operating_location_id,customer_id,document_kind,sales_order_id,journal_entry_id,created_by)
 values(t.company_id,t.business_unit_id,public.current_operating_location_id(),t.customer_id,
 case when t.sale_type='cash' then 'cash_hand_bill' else 'credit' end,(r->>'document_id')::uuid,(r->>'journal_entry_id')::uuid,auth.uid()) returning id into d;
 insert into public.transport_customer_document_trips(company_id,business_unit_id,document_id,trip_id,rate_snapshot,vat_snapshot)
 values(t.company_id,t.business_unit_id,d,t.id,t.customer_rate_snapshot,(r->>'vat')::numeric);
 perform public.transport_financial_audit(t.id,'customer_bill_posted',r||jsonb_build_object('transport_document_id',d,'sale_type',t.sale_type));
 return r||jsonb_build_object('transport_document_id',d);
end $function$
;

CREATE OR REPLACE FUNCTION public.transport_post_supplier_bill(p_rent_id uuid, p_date date, p_cost_account_id uuid, p_with_tax boolean DEFAULT false, p_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare x public.transport_trip_supplier_rents%rowtype;t public.transport_trips%rowtype;r jsonb;d uuid;
begin
 perform public.transport_finance_assert('rent');
 select * into x from public.transport_trip_supplier_rents where id=p_rent_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() for update;
 if not found then raise exception 'Finalized supplier rent required'; end if;t:=public.transport_financial_trip(x.trip_id);
 if x.state is distinct from 'finalized' or x.finalized_amount_snapshot is null or x.finalized_amount_snapshot is distinct from x.amount then raise exception 'Consistent finalized supplier rent snapshot required';end if;
 if exists(select 1 from public.transport_supplier_document_rents where rent_id=x.id and not is_adjustment) then raise exception 'Supplier rent already billed'; end if;
 r:=public.transport_create_service_document('supplier',x.supplier_id,p_date,x.finalized_amount_snapshot,p_with_tax,p_cost_account_id,public.transport_trip_service_description(t.id)||' · Supplier rent',p_reference);
 insert into public.transport_supplier_documents(company_id,business_unit_id,operating_location_id,supplier_id,purchase_order_id,journal_entry_id,created_by)
 values(x.company_id,x.business_unit_id,public.current_operating_location_id(),x.supplier_id,(r->>'document_id')::uuid,(r->>'journal_entry_id')::uuid,auth.uid()) returning id into d;
 insert into public.transport_supplier_document_rents(company_id,business_unit_id,document_id,rent_id,trip_id,amount_snapshot,vat_snapshot)
 values(x.company_id,x.business_unit_id,d,x.id,t.id,x.finalized_amount_snapshot,(r->>'vat')::numeric);
 perform public.transport_financial_audit(t.id,'supplier_bill_posted',r||jsonb_build_object('rent_id',x.id,'transport_document_id',d));return r;
end $function$
;

CREATE OR REPLACE FUNCTION public.transport_finalize_customer_rate(p_trip_id uuid, p_amount numeric, p_source text, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.transport_trips%rowtype; v_action text;
begin
 select * into t from public.transport_trips where id=p_trip_id for update;
 if not found or t.company_id is distinct from public.current_company_id() or t.business_unit_id is distinct from public.current_business_unit_id()
 then raise exception 'Transport Trip not found'; end if;
 v_action:=case when t.customer_rate_state='finalized' then 'customer_rate_override' else 'customer_rate_finalize' end;
 if not public.has_transport_action_permission(t.company_id,v_action) then raise exception 'Customer rate permission required'; end if;
 if v_action='customer_rate_override' and nullif(btrim(p_reason),'') is null then raise exception 'Override reason required'; end if;
 if p_amount is null or p_amount<0 or p_source not in ('agreed','manual') then raise exception 'Invalid customer rate/source'; end if;
 if t.customer_rate_state='finalized' and t.customer_rate=p_amount and t.customer_rate_snapshot=p_amount and t.customer_rate_source=p_source then return;end if;
 insert into public.transport_action_gate values(txid_current(),t.id,'customer_rate_finalize');
 update public.transport_trips set customer_rate=p_amount,customer_rate_snapshot=p_amount,customer_rate_state='finalized',
  customer_rate_source=p_source,customer_rate_finalized_at=now(),customer_rate_finalized_by=auth.uid() where id=t.id;
 delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=t.id and action='customer_rate_finalize';
 insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
 values(t.company_id,t.business_unit_id,t.id,t.trip_no,v_action,to_jsonb(t.customer_rate),to_jsonb(p_amount),p_reason,auth.uid());
end $function$
;

CREATE OR REPLACE FUNCTION public.transport_finalize_supplier_rent(p_rent_id uuid, p_amount numeric, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare r public.transport_trip_supplier_rents%rowtype; t public.transport_trips%rowtype; v_action text;
begin
 select * into r from public.transport_trip_supplier_rents where id=p_rent_id for update;
 if not found then raise exception 'Supplier rent not found'; end if;
 select * into t from public.transport_trips where id=r.trip_id for update;
 if r.company_id is distinct from public.current_company_id() or r.business_unit_id is distinct from public.current_business_unit_id()
 then raise exception 'Supplier rent outside active workspace'; end if;
 v_action:=case when r.state='finalized' then 'rent_correct' else 'rent_finalize' end;
 if not public.has_transport_action_permission(r.company_id,v_action) then raise exception 'Rent permission required'; end if;
 if v_action='rent_correct' and nullif(btrim(p_reason),'') is null then raise exception 'Correction reason required'; end if;
 if p_amount is null or p_amount<0 then raise exception 'Invalid rent amount'; end if;
 if r.state='finalized' and r.amount=p_amount and r.finalized_amount_snapshot=p_amount then return;end if;
 insert into public.transport_action_gate values(txid_current(),r.trip_id,'supplier_rent_finalize');
 update public.transport_trip_supplier_rents set amount=p_amount,state='finalized',finalized_amount_snapshot=p_amount,
 finalized_by=auth.uid(),finalized_at=now() where id=r.id;
 delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=r.trip_id and action='supplier_rent_finalize';
 insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
 values(r.company_id,r.business_unit_id,r.trip_id,t.trip_no,v_action,
  jsonb_build_object('supplier_id',r.supplier_id,'amount',r.amount),
  jsonb_build_object('supplier_id',r.supplier_id,'amount',p_amount),p_reason,auth.uid());
end $function$
;

CREATE OR REPLACE FUNCTION public.transport_replace_trip_assignment(p_trip_id uuid, p_vehicle_id uuid, p_driver_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.transport_trips%rowtype; v public.transport_vehicles%rowtype; d public.transport_drivers%rowtype;
 o public.transport_vehicle_ownership%rowtype;
 v_replaced_at timestamptz;
begin
 select * into t from public.transport_trips where id=p_trip_id for update;
 if not found or t.company_id is distinct from public.current_company_id() or t.business_unit_id is distinct from public.current_business_unit_id()
 then raise exception 'Transport Trip not found'; end if;
 if not public.has_transport_action_permission(t.company_id,'assignment_replace') or nullif(btrim(p_reason),'') is null
 then raise exception 'Replacement permission and reason required'; end if;
 if (p_vehicle_id,p_driver_id) is not distinct from (t.vehicle_id,t.driver_id) then raise exception 'Assignment did not change'; end if;
 if p_vehicle_id is not null then
  select * into v from public.transport_vehicles where id=p_vehicle_id and company_id=t.company_id and business_unit_id=t.business_unit_id and is_active;
  if not found then raise exception 'Active vehicle not found in workspace'; end if;
 end if;
 if p_driver_id is not null then
  select * into d from public.transport_drivers where id=p_driver_id and company_id=t.company_id and business_unit_id=t.business_unit_id and is_active;
  if not found then raise exception 'Active driver not found in workspace'; end if;
 end if;
 if p_vehicle_id is not null then
   select * into o from public.transport_vehicle_ownership where vehicle_id=p_vehicle_id
     and effective_from<=t.trip_date and (effective_to is null or effective_to>=t.trip_date)
     order by effective_from desc limit 1;
 end if;
 insert into public.transport_action_gate values(txid_current(),t.id,'assignment_replace');
 v_replaced_at := clock_timestamp();  update public.transport_trip_assignments  set ended_at=greatest(v_replaced_at,effective_at + interval '1 microsecond')  where trip_id=t.id and ended_at is null;  select coalesce((select ended_at from public.transport_trip_assignments  where trip_id=t.id and ended_at is not null  order by ended_at desc limit 1),v_replaced_at) into v_replaced_at;
 insert into public.transport_trip_assignments(company_id,business_unit_id,trip_id,vehicle_id,driver_id,
 vehicle_no_snapshot,driver_name_snapshot,owner_name_snapshot,effective_at,reason,actor_id)
 values(t.company_id,t.business_unit_id,t.id,p_vehicle_id,p_driver_id,v.vehicle_no,d.driver_name,
   coalesce(o.owner_name_snapshot,v.owner_name),v_replaced_at,p_reason,auth.uid());
 update public.transport_trips set vehicle_id=p_vehicle_id,driver_id=p_driver_id,
   ownership_id=o.id,owner_supplier_id=o.supplier_id,owner_name_snapshot=coalesce(o.owner_name_snapshot,v.owner_name)
 where id=t.id;
 delete from public.transport_action_gate where transaction_id=txid_current() and trip_id=t.id and action='assignment_replace';
 insert into public.transport_trip_audit(company_id,business_unit_id,trip_id,trip_no,action,old_value,new_value,reason,actor_id)
 values(t.company_id,t.business_unit_id,t.id,t.trip_no,'assignment_replace',
 jsonb_build_object('vehicle_id',t.vehicle_id,'driver_id',t.driver_id),
 jsonb_build_object('vehicle_id',p_vehicle_id,'driver_id',p_driver_id),p_reason,auth.uid());
end $function$
;

-- Authenticated expression-index writes need EXECUTE on this immutable pure text function.
revoke all on function public.transport_master_normalized_key(text) from public,anon;
grant execute on function public.transport_master_normalized_key(text) to authenticated;

revoke all on function public.transport_post_cost(uuid,text,uuid,numeric,date,uuid,boolean,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.transport_reviewed_cost_upload(p_request_id uuid, p_rows jsonb, p_supplier_id uuid, p_cost_account_id uuid, p_kind text, p_with_tax boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();h text;old public.transport_cost_upload_requests;x jsonb;result jsonb:='[]';
begin
 perform public.transport_finance_assert('cost');
 if p_request_id is null or p_kind not in ('driver_expense','vehicle_expense','commission','other') or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Upload 1–500 reviewed cost rows and valid kind';end if;
 h:=md5(jsonb_build_object('kind',p_kind,'rows',p_rows,'supplier',p_supplier_id,'account',p_cost_account_id,'tax',p_with_tax)::text);
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));select * into old from public.transport_cost_upload_requests where request_id=p_request_id;
 if found then
 if old.company_id is distinct from c or old.business_unit_id is distinct from b or old.operating_location_id is distinct from public.current_operating_location_id() or old.created_by is distinct from auth.uid() or old.payload_hash<>h then raise exception 'Upload request mismatch';end if;return old.result;end if;
 for x in select * from jsonb_array_elements(p_rows) loop
 if (x->>'amount') is null or x->>'amount' !~ '^[0-9]+(\.[0-9]{1,2})?$' or (x->>'amount')::numeric<=0 or (x->>'amount')::numeric<>round((x->>'amount')::numeric,2) then raise exception 'Positive two-decimal expense required';end if;
 result:=result||jsonb_build_array(public.transport_post_cost((x->>'trip_id')::uuid,p_kind,p_supplier_id,(x->>'amount')::numeric,(x->>'date')::date,p_cost_account_id,p_with_tax,x->>'reference'));
 end loop;
 insert into public.transport_cost_upload_requests(request_id,company_id,business_unit_id,operating_location_id,payload_hash,result,created_by) values(p_request_id,c,b,public.current_operating_location_id(),h,result,auth.uid());return result;
end $function$
;

-- Single costs share the proven persisted reviewed request contract.
create or replace function public.transport_post_cost_request(p_request_id uuid,p_trip_id uuid,p_kind text,p_supplier_id uuid,p_amount numeric,p_date date,p_cost_account_id uuid,p_with_tax boolean default false,p_reference text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare results jsonb;
begin
 results:=public.transport_reviewed_cost_upload(p_request_id,jsonb_build_array(jsonb_build_object('trip_id',p_trip_id,'amount',p_amount,'date',p_date,'reference',p_reference)),p_supplier_id,p_cost_account_id,p_kind,p_with_tax);
 return results->0;
end $$;
revoke all on function public.transport_post_cost_request(uuid,uuid,text,uuid,numeric,date,uuid,boolean,text) from public,anon;
grant execute on function public.transport_post_cost_request(uuid,uuid,text,uuid,numeric,date,uuid,boolean,text) to authenticated;


alter table public.transport_trip_audit add column if not exists source text;
alter table public.transport_trip_audit add column if not exists correlation_id text;
create or replace function public.transport_audit_source_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 new.source:=coalesce(new.source,nullif(current_setting('request.path',true),''),'database:transport');
 new.correlation_id:=coalesce(new.correlation_id,txid_current()::text);
 return new;
end $$;
revoke all on function public.transport_audit_source_guard() from public,anon,authenticated;
drop trigger if exists transport_audit_source_guard on public.transport_trip_audit;
create trigger transport_audit_source_guard before insert on public.transport_trip_audit for each row execute function public.transport_audit_source_guard();


CREATE OR REPLACE FUNCTION public.transport_trip_audit_report(p_trip_no text, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();n text:=upper(btrim(p_trip_no));answer jsonb;
begin
 if auth.uid() is null or c is null or b is null or not public.has_module_permission(c,'transport','view') then raise exception 'Transport view permission and active Company/Business Unit required';end if;
 if n is null or length(n) not between 1 and 120 then raise exception 'Enter an exact Trip No';end if;
 with filtered as materialized (
  select a.id,a.event_type,a.old_data,a.new_data,a.changed_by,a.actor_id,a.changed_at,a.occurred_at,a.reason,a.trip_no,a.correlation_id,coalesce(u.email,a.changed_by::text,a.actor_id::text,'Not recorded') actor_name,
   coalesce(a.changed_at,a.occurred_at) event_at,
   coalesce(a.source,a.new_data->>'source',a.old_data->>'source','Not recorded') source,
   coalesce(a.reason,a.new_data->>'reason',a.old_data->>'reason') event_reason
  from public.transport_trip_audit a left join public.user_profiles u on u.id=coalesce(a.changed_by,a.actor_id)
  where a.company_id=c and a.business_unit_id=b and upper(btrim(a.trip_no))=n
 ), page as (select * from filtered order by event_at asc nulls first,id asc limit greatest(1,least(coalesce(p_limit,500),500)) offset greatest(coalesce(p_offset,0),0)),
 ids as (select distinct v.value#>>'{}' id from filtered a cross join lateral jsonb_each(case when jsonb_typeof(a.old_data)='object' then a.old_data else '{}'::jsonb end) v
  union select distinct v.value#>>'{}' from filtered a cross join lateral jsonb_each(case when jsonb_typeof(a.new_data)='object' then a.new_data else '{}'::jsonb end) v),
 labels as (
  select id::text id,name label from public.customers where company_id=c and id::text in (select id from ids)
  union all select id::text,name from public.suppliers where company_id=c and id::text in (select id from ids)
  union all select id::text,driver_name from public.transport_drivers where company_id=c and business_unit_id=b and id::text in (select id from ids)
  union all select id::text,vehicle_no from public.transport_vehicles where company_id=c and business_unit_id=b and id::text in (select id from ids)
  union all select id::text,name from public.transport_locations where company_id=c and business_unit_id=b and id::text in (select id from ids)
  union all select id::text,name from public.transport_truck_types where company_id=c and business_unit_id=b and id::text in (select id from ids)
  union all select id::text,name from public.employees where company_id=c and id::text in (select id from ids)
 )
 select jsonb_build_object('trip_no',n,'rows',coalesce((select jsonb_agg(to_jsonb(p) order by p.event_at asc nulls first,p.id) from page p),'[]'::jsonb),
 'count',(select count(*) from filtered),'labels',coalesce((select jsonb_object_agg(id,label) from labels),'{}'::jsonb),
 'deleted',exists(select 1 from filtered) and not exists(select 1 from public.transport_trips t where t.company_id=c and t.business_unit_id=b and upper(btrim(t.trip_no))=n),
 'snapshot',coalesce((select coalesce(nullif(a.new_data,'{}'),a.old_data) from filtered a where coalesce(a.new_data,a.old_data) ? 'trip_no' order by a.event_at desc,a.id desc limit 1),'{}'::jsonb)) into answer;
 return answer;
end $function$
;

CREATE OR REPLACE FUNCTION public.transport_post_customer_bill_numbered(p_trip_id uuid, p_date date, p_with_tax boolean DEFAULT false, p_invoice_no text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.transport_trips%rowtype;r jsonb;d uuid;
begin
 perform public.transport_finance_assert('billing');t:=public.transport_financial_trip(p_trip_id);
 if t.customer_rate_state is distinct from 'finalized' or t.customer_rate_snapshot is null or t.customer_rate_snapshot is distinct from t.customer_rate then raise exception 'Consistent finalized customer rate snapshot required';end if;
 if t.sales_order_id is not null then raise exception 'Trip already references a canonical Sales document; reconcile its existing posted linkage before billing';end if;
 if t.sale_type is null or t.customer_id is null or t.customer_rate<=0
 or exists(select 1 from public.transport_customer_document_trips where trip_id=t.id and not is_adjustment)
 then raise exception 'Unbilled Trip, Cash/Credit classification, customer and positive finalized rate required'; end if;
 r:=public.transport_create_numbered_service_document('customer',t.customer_id,p_date,t.customer_rate_snapshot,p_with_tax,null,
 public.transport_trip_service_description(t.id),null,p_invoice_no);
 insert into public.transport_customer_documents(company_id,business_unit_id,operating_location_id,customer_id,document_kind,sales_order_id,journal_entry_id,created_by)
 values(t.company_id,t.business_unit_id,public.current_operating_location_id(),t.customer_id,
 case when t.sale_type='cash' then 'cash_hand_bill' else 'credit' end,(r->>'document_id')::uuid,(r->>'journal_entry_id')::uuid,auth.uid()) returning id into d;
 insert into public.transport_customer_document_trips(company_id,business_unit_id,document_id,trip_id,rate_snapshot,vat_snapshot)
 values(t.company_id,t.business_unit_id,d,t.id,t.customer_rate_snapshot,(r->>'vat')::numeric);
 perform public.transport_financial_audit(t.id,'customer_bill_posted',r||jsonb_build_object('transport_document_id',d,'sale_type',t.sale_type));
 return r||jsonb_build_object('transport_document_id',d);
end $function$
;

CREATE OR REPLACE FUNCTION public.transport_post_customer_bill_described(p_trip_id uuid, p_date date, p_with_tax boolean DEFAULT false, p_invoice_no text DEFAULT NULL::text, p_description text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare t public.transport_trips%rowtype;r jsonb;d uuid;
begin
 if length(coalesce(p_description,''))>2000 then raise exception 'Invoice description must be at most 2000 characters';end if;
 perform public.transport_finance_assert('billing');t:=public.transport_financial_trip(p_trip_id);
 if t.customer_rate_state is distinct from 'finalized' or t.customer_rate_snapshot is null or t.customer_rate_snapshot is distinct from t.customer_rate then raise exception 'Consistent finalized customer rate snapshot required';end if;
 if t.sales_order_id is not null then raise exception 'Trip already references a canonical Sales document; reconcile its existing posted linkage before billing';end if;
 if t.sale_type is null or t.customer_id is null or t.customer_rate<=0
 or exists(select 1 from public.transport_customer_document_trips where trip_id=t.id and not is_adjustment)
 then raise exception 'Unbilled Trip, Cash/Credit classification, customer and positive finalized rate required'; end if;
 r:=public.transport_create_numbered_service_document('customer',t.customer_id,p_date,t.customer_rate_snapshot,p_with_tax,null,
 concat_ws(E'\n',nullif(btrim(p_description),''),public.transport_trip_service_description(t.id)),null,p_invoice_no);
 insert into public.transport_customer_documents(company_id,business_unit_id,operating_location_id,customer_id,document_kind,sales_order_id,journal_entry_id,created_by)
 values(t.company_id,t.business_unit_id,public.current_operating_location_id(),t.customer_id,
 case when t.sale_type='cash' then 'cash_hand_bill' else 'credit' end,(r->>'document_id')::uuid,(r->>'journal_entry_id')::uuid,auth.uid()) returning id into d;
 insert into public.transport_customer_document_trips(company_id,business_unit_id,document_id,trip_id,rate_snapshot,vat_snapshot)
 values(t.company_id,t.business_unit_id,d,t.id,t.customer_rate_snapshot,(r->>'vat')::numeric);
 perform public.transport_financial_audit(t.id,'customer_bill_posted',r||jsonb_build_object('transport_document_id',d,'sale_type',t.sale_type));
 return r||jsonb_build_object('transport_document_id',d);
end $function$
;

CREATE OR REPLACE FUNCTION public.transport_post_supplier_bill_numbered(p_rent_id uuid, p_date date, p_cost_account_id uuid, p_with_tax boolean DEFAULT false, p_reference text DEFAULT NULL::text, p_invoice_no text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare x public.transport_trip_supplier_rents%rowtype;t public.transport_trips%rowtype;r jsonb;d uuid;
begin
 perform public.transport_finance_assert('rent');
 select * into x from public.transport_trip_supplier_rents where id=p_rent_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() for update;
 if not found then raise exception 'Finalized supplier rent required'; end if;t:=public.transport_financial_trip(x.trip_id);
 if x.state is distinct from 'finalized' or x.finalized_amount_snapshot is null or x.finalized_amount_snapshot is distinct from x.amount then raise exception 'Consistent finalized supplier rent snapshot required';end if;
 if exists(select 1 from public.transport_supplier_document_rents where rent_id=x.id and not is_adjustment) then raise exception 'Supplier rent already billed'; end if;
 r:=public.transport_create_numbered_service_document('supplier',x.supplier_id,p_date,x.finalized_amount_snapshot,p_with_tax,p_cost_account_id,public.transport_trip_service_description(t.id)||' · Supplier rent',p_reference,p_invoice_no);
 insert into public.transport_supplier_documents(company_id,business_unit_id,operating_location_id,supplier_id,purchase_order_id,journal_entry_id,created_by)
 values(x.company_id,x.business_unit_id,public.current_operating_location_id(),x.supplier_id,(r->>'document_id')::uuid,(r->>'journal_entry_id')::uuid,auth.uid()) returning id into d;
 insert into public.transport_supplier_document_rents(company_id,business_unit_id,document_id,rent_id,trip_id,amount_snapshot,vat_snapshot)
 values(x.company_id,x.business_unit_id,d,x.id,t.id,x.finalized_amount_snapshot,(r->>'vat')::numeric);
 perform public.transport_financial_audit(t.id,'supplier_bill_posted',r||jsonb_build_object('rent_id',x.id,'transport_document_id',d));return r;
end $function$
;

CREATE OR REPLACE FUNCTION public.transport_post_supplier_bill_described(p_rent_id uuid, p_date date, p_cost_account_id uuid, p_with_tax boolean DEFAULT false, p_reference text DEFAULT NULL::text, p_invoice_no text DEFAULT NULL::text, p_description text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare x public.transport_trip_supplier_rents%rowtype;t public.transport_trips%rowtype;r jsonb;d uuid;
begin
 if length(coalesce(p_description,''))>2000 then raise exception 'Invoice description must be at most 2000 characters';end if;
 perform public.transport_finance_assert('rent');
 select * into x from public.transport_trip_supplier_rents where id=p_rent_id and company_id=public.current_company_id() and business_unit_id=public.current_business_unit_id() for update;
 if not found then raise exception 'Finalized supplier rent required'; end if;t:=public.transport_financial_trip(x.trip_id);
 if x.state is distinct from 'finalized' or x.finalized_amount_snapshot is null or x.finalized_amount_snapshot is distinct from x.amount then raise exception 'Consistent finalized supplier rent snapshot required';end if;
 if exists(select 1 from public.transport_supplier_document_rents where rent_id=x.id and not is_adjustment) then raise exception 'Supplier rent already billed'; end if;
 r:=public.transport_create_numbered_service_document('supplier',x.supplier_id,p_date,x.finalized_amount_snapshot,p_with_tax,p_cost_account_id,concat_ws(E'\n',nullif(btrim(p_description),''),public.transport_trip_service_description(t.id)||' · Supplier rent'),p_reference,p_invoice_no);
 insert into public.transport_supplier_documents(company_id,business_unit_id,operating_location_id,supplier_id,purchase_order_id,journal_entry_id,created_by)
 values(x.company_id,x.business_unit_id,public.current_operating_location_id(),x.supplier_id,(r->>'document_id')::uuid,(r->>'journal_entry_id')::uuid,auth.uid()) returning id into d;
 insert into public.transport_supplier_document_rents(company_id,business_unit_id,document_id,rent_id,trip_id,amount_snapshot,vat_snapshot)
 values(x.company_id,x.business_unit_id,d,x.id,t.id,x.finalized_amount_snapshot,(r->>'vat')::numeric);
 perform public.transport_financial_audit(t.id,'supplier_bill_posted',r||jsonb_build_object('rent_id',x.id,'transport_document_id',d));return r;
end $function$
;
notify pgrst,'reload schema';
commit;
