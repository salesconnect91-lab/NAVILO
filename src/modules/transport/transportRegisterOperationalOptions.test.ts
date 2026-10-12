import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
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
  await db.exec('create table public.customers(id uuid primary key,name text);create table public.transport_vehicles(id uuid primary key,vehicle_no text,truck_type text);create table public.transport_drivers(id uuid primary key,driver_name text);create table public.transport_truc¶»§q«^