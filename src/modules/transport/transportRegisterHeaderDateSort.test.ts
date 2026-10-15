import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';

const migration = readFileSync(
 'supabase/migrations/20261015164500_transport_header_date_sort_and_charge_guards.sql',
 'utf8',
);

describe('Transport Register header options and money permissions',()=>{
 it('uses one chronological date-order expression for both fast and financial option queries',()=>{
  expect(migration).toContain('jsonb_agg(value order by value)');
  expect(migration).toContain('select jsonb_agg(value) from options');
  expect(migration).toContain("to_date(value,''DD-Mon-YY'')");
  expect(migration).toContain('DESC NULLS LAST');
  expect(migration).toContain("n_customer<>3 OR n_supplier<>3");
 });
 it('keeps customer and supplier charges under their own financial access rules',()=>{
  expect(migration).toContain("'''invoiced'',''charge''])");
  expect(migration).toContain("'''supplier_invoice_no'',''supplier_charges''])");
  expect(migration).toContain("IF n_customer<>3 OR n_supplier<>3");
 });
 it('sorts real dates rather than display strings and retains missing-value labels',async()=>{
  const db=await PGlite.create();
  try{
   const sql=`SELECT string_agg(v, ',' ORDER BY
     CASE WHEN v ~ '^[0-9]{2}-[A-Za-z]{3}-[0-9]{2}$'
       THEN to_date(v,'DD-Mon-YY') END DESC NULLS LAST, v) ordered
     FROM (VALUES ('31-Dec-25'),('02-Jan-26'),('15-Oct-26'),('?')) dates(v)`;
   const r=await db.query<{ordered:string}>(sql);
   expect(r.rows[0]?.ordered).toBe('15-Oct-26,02-Jan-26,31-Dec-25,?');
  }finally{await db.close()}
 });
});
