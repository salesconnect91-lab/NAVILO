-- Transport register 200k scale rehearsal.
-- LOCAL / ISOLATED DATABASE ONLY. NEVER RUN AGAINST PRODUCTION.
-- Purpose: create disposable synthetic trip-shaped rows without touching canonical financial evidence,
-- then benchmark the candidate/search/filter/sort/pagination primitives used by transport_register_query.
-- Everything is TEMP and transaction-scoped.

begin;

create temporary table transport_register_scale_fixture (
  id bigint generated always as identity primary key,
  company_id uuid not null,
  business_unit_id uuid not null,
  trip_no text not null,
  trip_date date not null,
  customer_name text,
  driver_name text,
  vehicle_no text,
  from_location text,
  to_location text,
  ppr_status text,
  po_do_job_no text,
  source_invoice_no text,
  amount numeric(18,2) not null default 0
) on commit drop;

insert into transport_register_scale_fixture
(company_id,business_unit_id,trip_no,trip_date,customer_name,driver_name,vehicle_no,from_location,to_location,ppr_status,po_do_job_no,source_invoice_no,amount)
select
 '00000000-0000-0000-0000-000000000001'::uuid,
 '00000000-0000-0000-0000-000000000002'::uuid,
 'OIC-'||lpad(g::text,6,'0'),
 date '2020-01-01'+(g%2500),
 'Customer '||(g%400),
 'Driver '||(g%700),
 'VEH-'||(g%1500),
 'From '||(g%120),
 'To '||(g%120),
 case when g%3=0 then 'received' else 'pending' end,
 'JOB-'||(g%10000),
 case when g%4=0 then 'INV-'||g else null end,
 (g%50000)::numeric
from generate_series(1,200000) g;

create index fixture_scope_date_id_idx on transport_register_scale_fixture(company_id,business_unit_id,trip_date desc,trip_no desc,id);
create index fixture_customer_date_idx on transport_register_scale_fixture(company_id,business_unit_id,customer_name,trip_date desc);
create index fixture_driver_date_idx on transport_register_scale_fixture(company_id,business_unit_id,driver_name,trip_date desc);
create index fixture_vehicle_date_idx on transport_register_scale_fixture(company_id,business_unit_id,vehicle_no,trip_date desc);
create index fixture_from_date_idx on transport_register_scale_fixture(company_id,business_unit_id,from_location,trip_date desc,trip_no desc);
create index fixture_to_date_idx on transport_register_scale_fixture(company_id,business_unit_id,to_location,trip_date desc,trip_no desc);
create index fixture_ppr_date_idx on transport_register_scale_fixture(company_id,business_unit_id,ppr_status,trip_date desc,trip_no desc);
create index fixture_trip_no_lower_prefix_idx on transport_register_scale_fixture(company_id,business_unit_id,lower(trip_no) text_pattern_ops);
analyze transport_register_scale_fixture;

do $$
declare n bigint;
begin
 select count(*) into n from transport_register_scale_fixture;
 if n<>200000 then raise exception 'Expected 200000 fixture rows, got %',n; end if;

 -- Global filter must find matches outside the first 500 physical rows.
 select count(*) into n
 from transport_register_scale_fixture
 where company_id='00000000-0000-0000-0000-000000000001'
   and business_unit_id='00000000-0000-0000-0000-000000000002'
   and customer_name='Customer 399';
 if n<=0 then raise exception 'Global customer filter returned no rows'; end if;

 -- Search target deliberately lies far beyond page 1.
 select count(*) into n
 from transport_register_scale_fixture
 where company_id='00000000-0000-0000-0000-000000000001'
   and business_unit_id='00000000-0000-0000-0000-000000000002'
   and lower(trip_no) like 'oic-199999%';
 if n<>1 then raise exception 'Global Trip search contract failed: %',n; end if;

 -- 500-row page contract after global filter + sort.
 select count(*) into n from (
   select id from transport_register_scale_fixture
   where company_id='00000000-0000-0000-0000-000000000001'
     and business_unit_id='00000000-0000-0000-0000-000000000002'
     and trip_date between date '2022-01-01' and date '2025-12-31'
   order by trip_date desc,trip_no desc,id
   limit 500 offset 5000
 ) q;
 if n<>500 then raise exception '500-row deep-page contract failed: %',n; end if;
end $$;

-- Run these manually with EXPLAIN (ANALYZE,BUFFERS,TIMING) in the isolated DB
-- to record machine-specific latency. No hard millisecond threshold is asserted because
-- CI/local hardware differs; correctness and plan/index usage are the release contract.
explain (analyze,buffers,timing)
select id from transport_register_scale_fixture
where company_id='00000000-0000-0000-0000-000000000001'
  and business_unit_id='00000000-0000-0000-0000-000000000002'
order by trip_date desc,trip_no desc,id
limit 500 offset 50000;

explain (analyze,buffers,timing)
select id from transport_register_scale_fixture
where company_id='00000000-0000-0000-0000-000000000001'
  and business_unit_id='00000000-0000-0000-0000-000000000002'
  and customer_name='Customer 399'
order by trip_date desc,trip_no desc,id
limit 500;

explain (analyze,buffers,timing)
select id from transport_register_scale_fixture
where company_id='00000000-0000-0000-0000-000000000001'
  and business_unit_id='00000000-0000-0000-0000-000000000002'
  and lower(trip_no) like 'oic-199999%'
order by trip_date desc,trip_no desc,id
limit 500;

rollback;
