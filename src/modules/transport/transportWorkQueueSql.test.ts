import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
const c='c611adca-fd2f-4cc1-b379-3aed22924f65';
const b='bbd67d8b-930e-4ef4-8f61-0061f07b686a';
const loc='1dbdf12e-ffa6-4da2-b379-8c0f62796098';
it('bounds department work queues, preserves tenant scope, and avoids financial evidence joins',async()=>{
  const db=await PGlite.create();
  try{
    await db.exec("create role authenticated; create role anon; create role service_role; create schema auth; create function auth.uid() returns uuid language sql as $$select '11111111-1111-1111-1111-111111111111'::uuid$$;");
    await db.exec(`create function public.current_company_id() returns uuid language sql as $$select '${c}'::uuid$$;`);
    await db.exec(`create function public.current_business_unit_id() returns uuid language sql as $$select '${b}'::uuid$$;`);
    await db.exec(`create function public.current_operating_location_id() returns uuid language sql as $$select '${loc}'::uuid$$;`);
    await db.exec("create function public.has_module_permission(uuid,text,text) returns boolean language sql as $$select true$$;create function public.transport_financial_read_allowed(text) returns boolean language sql as $$select true$$;");
    await db.exec("create table public.customers(id uuid primary key,name text);create table public.transport_vehicles(id uuid primary key,vehicle_no text);create table public.transport_drivers(id uuid primary key,driver_name text);");
    await db.exec("create table public.transport_trips(id uuid primary key,company_id uuid,business_unit_id uuid,operating_location_id uuid,customer_id uuid,vehicle_id uuid,driver_id uuid,customer_name_snapshot text,trip_no text,trip_date date,truck_type text,po_do_job_no text,from_location text,to_location text,ppr_status text,ppr_received_by_name text,ppr_received_date date,customer_rate_status text,supplier_rent_status text,trip_status text);");
    await db.exec("create table public.transport_historical_trip_identity(trip_id uuid,company_id uuid,business_unit_id uuid,operating_location_id uuid,driver_name_snapshot text,vehicle_no_snapshot text);");
    await db.exec(`insert into public.transport_trips
      select md5(i::text)::uuid,'${c}'::uuid,'${b}'::uuid,'${loc}'::uuid,null,null,null,'Customer '||i,
      'TR-'||lpad(i::text,5,'0'),'2026-10-12'::date-(i%20),'Truck','JOB-'||i,'Dammam','Riyadh',
      case when i%2=0 then 'received' else 'pending' end,null,null,
      case when i%3=0 then 'finalized' else 'pending' end,
      case when i%4=0 then 'finalized' else 'pending' end,'draft'
      from generate_series(1,140) i;`);
    await db.exec(`insert into public.transport_trips
      select md5(('foreign'||i)::text)::uuid,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,'${b}'::uuid,'${loc}'::uuid,null,null,null,'FOREIGN',
      'FOREIGN-'||i,'2026-10-12'::date,'Truck','JOB-X','X','Y','pending',null,null,'pending','pending','draft'
      from generate_series(1,20) i;`);
    await db.exec(`insert into public.transport_historical_trip_identity values
      (md5('1')::uuid,'${c}'::uuid,'${b}'::uuid,'${loc}'::uuid,'Original Driver','Original Plate');`);
    const sql=readFileSync('supabase/migrations/20261012103151_transport_department_work_queues.sql','utf8');
    await db.exec(sql);
    const get=async(desk:string,page=0,search='')=>{
      const r=await db.query<{data:any}>(`select public.transport_work_queue($1,$2,$3) as data`,[desk,page,search]);
      return r.rows[0].data;
    };
    const first=await get('operations');
    expect(first.rows).toHaveLength(50);
    expect(first.has_more).toBe(true);
    expect(first.rows.every((r:any)=>!String(r.trip_no).startsWith('FOREIGN'))).toBe(true);
    expect(first.rows[0]).not.toHaveProperty('customer_rate');
    const third=await get('operations',2);
    expect(third.rows).toHaveLength(40);
    expect(third.has_more).toBe(false);
    expect((await get('ppr')).rows.every((r:any)=>r.ppr_status!=='received')).toBe(true);
    expect((await get('billing')).rows.every((r:any)=>r.customer_rate_status==='pending')).toBe(true);
    expect((await get('supplier')).rows.every((r:any)=>r.supplier_rent_status==='pending')).toBe(true);
    const found=await get('operations',0,'TR-00001');
    expect(found.rows).toHaveLength(1);
    expect(found.rows[0].driver).toBe('Original Driver');
    expect(found.rows[0].vehicle).toBe('Original Plate');
    await expect(get('unknown')).rejects.toThrow(/Invalid Transport work queue/);
    await expect(get('operations',1001)).rejects.toThrow(/Invalid Transport work queue/);
  }finally{await db.close();}
},30000);
