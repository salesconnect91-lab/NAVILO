import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
const c='c611adca-fd2f-4cc1-b379-3aed22924f65';
const b='bbd67d8b-930e-4ef4-8f61-0061f07b686a';
const loc='1dbdf12e-ffa6-4da2-b379-8c0f62796098';
it('fetches complete scoped cascaded operational options without the financial views (12000 trips)',async()=>{
 const db=await PGlite.create();
 try{
  await db.exec("create schema auth; create function auth.uid() returns uuid language sql as $$select '11111111-1111-1111-1111-111111111111'::uuid$$;");
  await db.exec(`create function public.current_company_id() returns uuid language sql as $$select '${c}'::uuid$$;`);
  await db.exec(`create function public.current_business_unit_id() returns uuid language sql as $$select '${b}'::uuid$$;`);
  await db.exec(`create function public.current_operating_location_id() returns uuid language sql as $$select '${loc}'::uuid$$;`);
  await db.exec('create function public.has_module_permission(uuid,text,text) returns boolean language sql as $$select true$$; create function public.transport_financial_read_allowed(text) returns boolean language sql as $$select true$$;');
  await db.exec('create table public.customers(id uuid primary key,name text);create table public.transport_vehicles(id uuid primary key,vehicle_no text,truck_type text);create table public.transport_drivers(id uuid primary key,driver_name text);create table public.transport_truck_types(id uuid primary key,name text);');
  await db.exec('create table public.transport_trips(id uuid primary key,company_id uuid,business_unit_id uuid,operating_location_id uuid,customer_id uuid,vehicle_id uuid,driver_id uuid,truck_type_id uuid,customer_name_snapshot text,trip_no text,trip_date date,truck_type text,po_do_job_no text,from_location text,to_location text,ppr_status text,ppr_received_by_name text,ppr_received_date date);');
  await db.exec('create table public.transport_historical_trip_identity(trip_id uuid,company_id uuid,business_unit_id uuid,operating_location_id uuid,driver_name_snapshot text,vehicle_no_snapshot text);');
  await db.exec(`insert into public.transport_trips(id,company_id,business_unit_id,operating_location_id,customer_name_snapshot,trip_no,trip_date,truck_type,po_do_job_no,from_location,to_location,ppr_status) select md5(i::text)::uuid,'${c}'::uuid,'${b}'::uuid,'${loc}'::uuid,case when i<=6000 then 'Twakkal' else 'Other Customer' end,'OIC-'||lpad(i::text,6,'0'),'2026-10-01','Flatbed','PO'||i,case when i%2=0 then 'Dammam' else 'Riyadh' end,'Jeddah','pending' from generate_series(1,12000) i;`);
  await db.exec(`insert into public.transport_historical_trip_identity(trip_id,company_id,business_unit_id,operating_location_id,driver_name_snapshot,vehicle_no_snapshot) select md5(i::text)::uuid,'${c}'::uuid,'${b}'::uuid,'${loc}'::uuid,'Driver '||lpad((i%1205)::text,4,'0'),case when i%2=0 then '5731' else '9988' end from generate_series(1,12000) i;`);
  await db.exec(`insert into public.transport_trips(id,company_id,business_unit_id,operating_location_id,customer_name_snapshot,trip_no,trip_date,truck_type,from_location,to_location,ppr_status) values ('ffffffff-ffff-ffff-ffff-ffffffffffff','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','${b}','${loc}','OUT OF SCOPE','OIC-SECRET','2026-10-01','Flatbed','Dammam','Jeddah','pending');`);
  await db.exec('create unique index hi_trip_lookup_test on public.transport_historical_trip_identity(trip_id);create index trips_scope_test on public.transport_trips(company_id,business_unit_id,operating_location_id);analyze public.transport_trips; analyze public.transport_historical_trip_identity;');
  const migration=readFileSync('supabase/migrations/20261012073000_transport_register_operational_filter_fast_path.sql','utf8');
  const original=readFileSync('supabase/migrations/20261012060515_transport_register_complete_filter_options.sql','utf8');
  const startText='CREATE OR REPLACE FUNCTION public.transport_register_query(';
  await db.exec('set check_function_bodies=off');
  await db.exec(original.slice(original.indexOf(startText)));
  const fingerprint=await db.query<{hash:string}>("select md5(pg_get_functiondef(oid)) hash from pg_proc where pronamespace='public'::regnamespace and proname='transport_register_query'");
  expect(migration).toContain('9fc2c90cb4477626756322bf5bb5ed9d');
  expect(migration).toContain('$register_fast_path$');
  await db.exec(migration.replace('9fc2c90cb4477626756322bf5bb5ed9d',fingerprint.rows[0].hash));
  const patched=await db.query<{definition:string}>("select pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace and proname='transport_register_query'");
  expect(patched.rows[0].definition).toContain(' -- Unposted operational filter values');
  async function options(key:string,filters:Record<string,unknown>={},search=''){
   const result=await db.query<{res:{options:string[]}}>("select public.transport_register_query(100,0,$1::jsonb,'','asc',$2,$3) res",[JSON.stringify(filters),key,search]);
   return result.rows[0].res.options;
  }
  const drivers=await options('driver');expect(drivers).toHaveLength(1205);expect(drivers).not.toContain('OUT OF SCOPE');
  const named=await options('driver',{},'Driver 12');expect(named.length).toBeGreaterThan(0);expect(named.every(x=>x.startsWith('Driver 12'))).toBe(true);
  const dammam=await options('plate',{columns:{from:['Dammam'],driver:['Driver 0001']}});expect(dammam).toEqual(['5731']);
  const selfIgnored=await options('plate',{columns:{plate:['no-such-plate'],from:['Dammam']}});expect(selfIgnored).toEqual(['5731']);
  const matching=await options('driver',{customer:'Twakkal',columns:{from:['Dammam']}});expect(matching.length).toBeGreaterThan(1000);
 }finally{await db.close()}
},120000);
