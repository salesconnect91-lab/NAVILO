import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
// PostgreSQL-in-WASM rehearsal; not a full local Supabase stack or concurrent-session test.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
let db;
if(process.env.NAVILO_NATIVE_REHEARSAL==='1'){
 const driver=process.env.NAVILO_PG_DRIVER;
 if(process.env.GITHUB_ACTIONS!=='true'||!driver||!path.isAbsolute(driver))throw new Error('Native rehearsal is restricted to the isolated CI service');
 const pg=await import(pathToFileURL(driver).href);const Client=pg.Client??pg.default.Client;
 const client=new Client({host:'127.0.0.1',port:6543,user:'postgres',password:'navilo-rehearsal-only',database:'navilo_transport_rehearsal'});
 await client.connect();
 const check=await client.query("select current_database() name,(select count(*)::integer from pg_tables where schemaname in ('public','auth','storage')) tables");
 if(check.rows[0].name!=='navilo_transport_rehearsal'||check.rows[0].tables!==0){await client.end();throw new Error('Rehearsal requires a fresh empty dedicated CI database');}
 client.on('notice',n=>{if(process.env.NAVILO_PROFILE_REHEARSAL==='1'||/Trips|50,000|20,000/.test(n.message))console.log('SCALE',n.message)});
 db={exec:sql=>client.query(sql),query:(sql,params)=>client.query(sql,params),close:()=>client.end()};
 await client.query('set jit=off');console.log('NATIVE POSTGRES ISOLATED CI; jit=off matches verified production setting');
}else db=await PGlite.create();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema storage;
alter default privileges in schema public grant all on tables to authenticated,service_role;
alter default privileges in schema public grant all on sequences to authenticated,service_role;
create table auth.users(id uuid primary key,instance_id uuid,email text,role text,aud text,encrypted_password text,raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,created_at timestamptz,updated_at timestamptz,is_super_admin boolean,confirmation_token text,recovery_token text,email_change_token_new text,email_change text);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')||jsonb_build_object('sub',auth.uid())$$;
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated')$$;
create function auth.email() returns text language sql stable as $$select auth.jwt()->>'email'$$;
grant usage on schema auth to anon,authenticated,service_role;grant execute on all functions in schema auth to anon,authenticated,service_role;
create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text,metadata jsonb,created_at timestamptz default now(),updated_at timestamptz default now());alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql immutable as $$select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;`);
let count=0;
for(const file of fs.readdirSync(root+'/supabase/migrations').filter(f=>f.endsWith('.sql')).sort()){
 try{await db.exec(fs.readFileSync(root+'/supabase/migrations/'+file,'utf8').replace(/^\uFEFF/,''));count++;}
 catch(e){console.log('FAIL',file,e.message);await db.close();throw new Error(file+': '+e.message)}
}
console.log('REPLAY PASS',count);
if(process.env.NAVILO_PROFILE_REHEARSAL==='1'){if(process.env.NAVILO_NATIVE_REHEARSAL!=='1')throw new Error('Profile only the isolated native CI service');await db.exec("CREATE EXTENSION pg_stat_statements; SET pg_stat_statements.track='all'; SET pg_stat_statements.track_planning=on; SELECT pg_stat_statements_reset();");}

const notice=notice=>{if(/Trips|50,000|20,000/.test(notice.message))console.log('SCALE',notice.message)};
if(process.env.NAVILO_HISTORY_SCALE){
 const total=Number(process.env.NAVILO_HISTORY_SCALE);if(!Number.isInteger(total)||total<25||total>20000||total%25)throw new Error('History scale count requires a multiple of 25, at most 20,000');
 const sql=fs.readFileSync(root+'/supabase/tests/transport_historical_scale_rehearsal.sql','utf8').replaceAll('NAVILO_HISTORY_COUNT',String(total));const parts=sql.split('-- NAVILO_HISTORY_BATCHES');await db.exec(parts[0]);await db.exec('analyze');const started=Date.now();
 for(let batch=0;batch<total/25;batch++){const batchStart=Date.now();await db.query('select pg_temp.history_scale_batch($1)',[batch]);if(batch%4===3){await db.exec('analyze journal_entries;analyze journal_lines;analyze ledgers;analyze invoice_payment_allocations;analyze purchase_payment_allocations;analyze sales_orders;analyze purchase_orders;analyze transport_trips;analyze transport_trip_assignments;analyze transport_customer_documents;analyze transport_supplier_documents;analyze transport_history_import_rows;analyze transport_history_import_jobs;');await db.exec('checkpoint');if(globalThis.gc)globalThis.gc();console.log('HISTORY MEMORY MB',Math.round(process.memoryUsage().rss/1048576));console.log('HISTORY SCALE', (batch+1)*25, 'trips; last batch ms',Date.now()-batchStart,'elapsed ms',Date.now()-started);}}
 await db.exec(parts[1]);console.log('PASS historical canonical accounting scale',total,'trips ms',Date.now()-started);
}else if(process.env.NAVILO_SCALE_TEST==='1'){
 const sql=fs.readFileSync(root+'/supabase/tests/transport_scale_import_rehearsal.sql','utf8');
 const parts=sql.split('-- NAVILO_SCALE_BATCHES: runner executes 200 independently committed calls here.');
 await db.exec(parts[0]);const started=Date.now();
 for(let batch=0;batch<200;batch++){await db.query('select pg_temp.navilo_scale_batch($1)',[batch]);if(batch%20===19)console.log('SCALE Trips imported:',(batch+1)*100);}
 console.log('SCALE 20,000 independently committed import ms:',Date.now()-started);
 await db.exec(parts[1],{onNotice:notice});console.log('PASS transport_scale_import_rehearsal.sql');
}else{
 for(const file of (process.env.NAVILO_HISTORY_SMOKE==='1'?['transport_historical_import_rehearsal.sql']:process.env.NAVILO_BENCHMARK_ONLY==='1'?['transport_register_benchmark.sql']:process.env.NAVILO_READER_SMOKE==='1'?['transport_scale_reader_rehearsal.sql']:['transport_release_controls_rehearsal.sql','scope_plan_cache_rehearsal.sql','transport_historical_import_rehearsal.sql','transport_party_reporting_rehearsal.sql','transport_v1_financial_completion_rehearsal.sql','tax_posting_reconciliation_rehearsal.sql','transport_ppr_account_rehearsal.sql','transport_initial_rate_vehicle_rehearsal.sql','transport_large_expense_rehearsal.sql','transport_cash_receive_rehearsal.sql','transport_advance_rehearsal.sql','transport_master_data_rehearsal.sql','transport_new_trip_entry_rehearsal.sql','transport_scale_reader_rehearsal.sql','authenticated_tenant_isolation_rehearsal.sql','authenticated_customer_rls_rehearsal.sql','authenticated_accounting_rpc_rehearsal.sql','fx_account_mapping_rehearsal.sql','fx_commercial_closeout_rehearsal.sql','fx_invoice_posting_bridge_rehearsal.sql','fx_invoice_settlement_components_rehearsal.sql','fx_per_line_rate_rehearsal.sql','invoice_base_currency_guard_rehearsal.sql','invoice_currency_snapshot_rehearsal.sql','multi_currency_journal_rehearsal.sql','multi_currency_manual_post_rehearsal.sql'])){
  if(!fs.existsSync(root+'/supabase/tests/'+file))throw new Error('Missing required rehearsal: '+file);
  try{await db.exec(fs.readFileSync(root+'/supabase/tests/'+file,'utf8').replace(/^\uFEFF/,''),{onNotice:notice});console.log('PASS',file)}catch(e){console.log('FAIL TEST',file,e.message);await db.close();throw new Error(file+': '+e.message)}
 }
}
if(process.env.NAVILO_CONCURRENCY_FIXTURE_SMOKE==='1'){await db.exec(fs.readFileSync(root+'/supabase/tests/transport_release_concurrency_fixture.sql','utf8'));console.log('PASS concurrent native fixture setup');}
if(process.env.NAVILO_PROFILE_REHEARSAL==='1'){const stats=await db.query("select query,calls,plans,total_plan_time,total_exec_time,rows from pg_stat_statements order by total_plan_time+total_exec_time desc limit 100");console.log('PROFILE STATISTICS',JSON.stringify(stats.rows));}
if(process.env.NAVILO_NATIVE_REHEARSAL==='1'&&!process.env.NAVILO_HISTORY_SCALE&&!process.env.NAVILO_SCALE_TEST&&!process.env.NAVILO_HISTORY_SMOKE&&!process.env.NAVILO_BENCHMARK_ONLY&&!process.env.NAVILO_READER_SMOKE){const {runTransportConcurrency}=await import('./transport_release_concurrency.mjs');const driver=await import(pathToFileURL(process.env.NAVILO_PG_DRIVER).href);await runTransportConcurrency(db,driver.Client??driver.default.Client);}
await db.close();
