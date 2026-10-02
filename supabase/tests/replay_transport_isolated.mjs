import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
// PostgreSQL-in-WASM rehearsal; not a full local Supabase stack or concurrent-session test.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const db=await PGlite.create();
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
for(const file of ['transport_party_reporting_rehearsal.sql','transport_v1_financial_completion_rehearsal.sql','tax_posting_reconciliation_rehearsal.sql','transport_ppr_account_rehearsal.sql','transport_initial_rate_vehicle_rehearsal.sql','transport_large_expense_rehearsal.sql','transport_cash_receive_rehearsal.sql','transport_advance_rehearsal.sql','transport_master_data_rehearsal.sql','transport_new_trip_entry_rehearsal.sql']){
 if(!fs.existsSync(root+'/supabase/tests/'+file))throw new Error('Missing required rehearsal: '+file);
 try{await db.exec(fs.readFileSync(root+'/supabase/tests/'+file,'utf8'));console.log('PASS',file)}catch(e){console.log('FAIL TEST',file,e.message);await db.close();throw new Error(file+': '+e.message)}
}
await db.close();
