import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
it('lists over 1200 options without the 200-value cutoff, with search',async()=>{
 const migration=readFileSync('supabase/migrations/20261012054718_transport_register_complete_filter_options.sql','utf8');
 const start=migration.indexOf(' options as (select');
 const end=migration.indexOf('),\n statuses as (',start);
 expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
 const optionsCte=migration.slice(start,end+1);expect(optionsCte).not.toMatch(/limit\s+200/i);
 const db=await PGlite.create();
 try {
  await db.exec('create table fixture(vals jsonb not null)');
  await db.exec("insert into fixture(vals) select jsonb_build_object('cells',jsonb_build_object('company','Client '||lpad(i::text,4,'0')),'numbers','{}'::jsonb) from generate_series(1,1205) i");
  async function all(search:string){
   const sql="with filtered as (select f.vals,p.p_option_key,p.p_option_search from fixture f cross join (select 'company'::text p_option_key,$1::text p_option_search) p),"+optionsCte+" select value from options";
   return (await db.query<{value:string}>(sql,[search])).rows.map(r=>r.value);
  }
  const items=await all('');expect(items).toHaveLength(1205);expect(items[0]).toBe('Client 0001');expect(items[items.length-1]).toBe('Client 1205');
  const result=await all('Client 12');expect(result).toHaveLength(6);expect(result).toContain('Client 1205');
 }finally{await db.close()}
},30000);
