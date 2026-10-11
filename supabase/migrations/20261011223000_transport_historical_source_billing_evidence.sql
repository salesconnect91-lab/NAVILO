-- Preserve an original per-Trip billing mode only inside an authorized source import.
-- Customer Master and ordinary Trip/invoice billing rules are unchanged.
create table public.transport_historical_mode_gate (
 transaction_id bigint not null,actor_id uuid not null,company_id uuid not null,
 business_unit_id uuid not null,customer_id uuid not null,sale_type text not null check(sale_type in('cash','credit')),
 primary key(transaction_id,actor_id)
);
alter table public.transport_historical_mode_gate enable row level security;
revoke all on public.transport_historical_mode_gate from public,anon,authenticated;
create table public.transport_historical_billing_evidence (
 trip_id uuid primary key references public.transport_trips(id),company_id uuid not null,
 business_unit_id uuid not null,operating_location_id uuid not null,customer_id uuid not null,
 source_company text not null,source_trip_id text not null,source_file_hash text not null,
 source_row integer not null check(source_row>=2),source_trip_date date not null,
 sale_type text not null check(sale_type in('cash','credit')),created_by uuid not null,created_at timestamptz not null default now()
);
alter table public.transport_historical_billing_evidence enable row level security;
revoke all on public.transport_historical_billing_evidence from public,anon,authenticated;
grant select on public.transport_historical_billing_evidence to authenticated;
create policy transport_historical_billing_read on public.transport_historical_billing_evidence for select to authenticated using (
 company_id=(select public.current_company_id()) and business_unit_id=(select public.current_business_unit_id())
 and operating_location_id=(select public.current_operating_location_id())
 and public.has_module_permission(company_id,'transport','view')
 and public.transport_financial_read_allowed('customer') and public.transport_financial_read_allowed('supplier')
);
create function public.transport_historical_billing_immutable() returns trigger language plpgsql as $$
begin raise exception 'Original historical billing evidence is immutable';end $$;
revoke all on function public.transport_historical_billing_immutable() from public,anon,authenticated;
create trigger transport_historical_billing_immutable before update or delete on public.transport_historical_billing_evidence
for each row execute function public.transport_historical_billing_immutable();
do $$
declare definition text;anchor text:= ' if p_customer is null then raise exception ''Select a customer before creating the Trip'';end if;';
begin
 definition:=pg_get_functiondef('public.transport_trip_customer_sale_type(uuid,uuid,uuid)'::regprocedure);
 if position(anchor in definition)=0 or position('transport_historical_mode_gate' in definition)>0 then raise exception 'Unexpected billing helper; review required';end if;
 definition:=replace(definition,anchor,anchor||E'\n select g.sale_type into v_mode from public.transport_historical_mode_gate g\n where g.transaction_id=txid_current() and g.actor_id=auth.uid()\n and g.company_id=p_company and g.business_unit_id=p_business_unit and g.customer_id=p_customer;\n if found then return v_mode;end if;');
 execute definition;
end $$;
create function public.transport_create_historical_source_trips(p_request_id uuid,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c uuid:=public.current_company_id();b uuid:=public.current_business_unit_id();loc uuid:=public.current_operating_location_id();
 r jsonb;made jsonb;answer jsonb:='[]';i integer:=0;tid uuid;customer uuid;mode text;hash text;source_name text;
begin
 if auth.uid() is null or c is null or b is null or loc is null or p_request_id is null
 or not public.has_module_permission(c,'transport','edit') or not public.has_transport_action_permission(c,'master_manage')
 or not public.has_transport_action_permission(c,'assignment_replace')
 or not public.transport_financial_read_allowed('customer') or not public.transport_financial_read_allowed('supplier')
 then raise exception 'Authorized historical import and active workspace required';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 100
 or octet_length(p_rows::text)>250000 then raise exception '1–100 original source rows required';end if;
 if exists(select 1 from public.transport_historical_mode_gate where transaction_id=txid_current() and actor_id=auth.uid())
 then raise exception 'Nested historical billing context is not permitted';end if;
 for r in select value from jsonb_array_elements(p_rows) loop
  hash:=r->>'source_file_hash';source_name:=r->>'source_company';mode:=r->>'sale_type';customer:=(r->>'customer_id')::uuid;
  if hash is null or hash !~ '^[a-f0-9]{64}$' or (r->>'source_row')::integer<2 or r->>'source_row' is null
  or r->>'source_trip_id' is null or r->>'source_trip_id' !~ '^[0-9]+$' or mode is null or mode not in('cash','credit')
  or not exists(select 1 from public.transport_historical_trip_identity h where h.company_id=c and h.business_unit_id=b
   and h.operating_location_id=loc and h.source_company=source_name and h.source_file_hash=hash)
  then raise exception 'Original mode, row, ID and registered source file evidence required';end if;
  insert into public.transport_historical_mode_gate values(txid_current(),auth.uid(),c,b,customer,mode);
  made:=public.transport_create_source_trips(md5(p_request_id::text||':'||i::text)::uuid,
    jsonb_build_array(r-'source_file_hash'-'source_row'));
  delete from public.transport_historical_mode_gate where transaction_id=txid_current() and actor_id=auth.uid();
  tid:=(made->0->>'id')::uuid;
  if not exists(select 1 from public.transport_trips t where t.id=tid and t.company_id=c and t.business_unit_id=b
    and t.operating_location_id=loc and t.sale_type=mode and t.customer_id=customer
    and t.trip_date=(r->>'trip_date')::date and t.transport_source_company=source_name and t.transport_source_trip_id=r->>'source_trip_id')
  then raise exception 'Historical billing source verification failed';end if;
  insert into public.transport_historical_billing_evidence(trip_id,company_id,business_unit_id,operating_location_id,customer_id,
    source_company,source_trip_id,source_file_hash,source_row,source_trip_date,sale_type,created_by)
  values(tid,c,b,loc,customer,source_name,r->>'source_trip_id',hash,(r->>'source_row')::integer,(r->>'trip_date')::date,mode,auth.uid());
  answer:=answer||made;i:=i+1;
 end loop;
 return answer;
end $$;
revoke all on function public.transport_create_historical_source_trips(uuid,jsonb) from public,anon;
grant execute on function public.transport_create_historical_source_trips(uuid,jsonb) to authenticated;
