import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
it('searches literal prefixes and contains across all cells before pagination',async()=>{
 const db=await PGlite.create();
 try{
 const migration=readFileSync('supabase/migrations/20261008184452_transport_register_search_modes.sql','utf8');
 const predicate=migration.split('$new$')[1].replace(/^\s*and /,'');
 const rows=[{trip_no:'TRP-2',company:'Steel Works',plate:'2123'},{trip_no:'ATR-12',company:'Metal Works',plate:'1202'},{trip_no:'%literal',company:'_literal',plate:'999'}];
 await db.exec('create table fixture(vals jsonb,status text,ppr_status text)');
 for(const cells of rows)await db.query('insert into fixture values($1,\'draft\',\'pending\')',[JSON.stringify({cells})]);
 async function count(search:string,searchMode:string){const r=await db.query<{n:number}>(`select count(*)::int n from fixture x cross join (select $1::jsonb p_filters) f where ${predicate}`,[JSON.stringify({search,searchMode})]);return r.rows[0].n}
 expect(await count('T','starts_with')).toBe(1);
 expect(await count('2','starts_with')).toBe(1);
 expect(await count('2','contains')).toBe(2);
 expect(await count('Works','starts_with')).toBe(2);
 expect(await count('steel','starts_with')).toBe(1);
 expect(await count('%','starts_with')).toBe(1);
 expect(await count('_','starts_with')).toBe(1);
 expect(await count('','starts_with')).toBe(3);
 expect(await count('2','unknown')).toBe(2);
 }finally{await db.close()}
},20000);
