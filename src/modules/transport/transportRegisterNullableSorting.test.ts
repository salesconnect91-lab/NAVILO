import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';

const migration=readFileSync('supabase/migrations/20261015170000_transport_register_nullable_header_sorting.sql','utf8');

describe('Register sorting keeps absent values last',()=>{
 it('guards both page order and row-number sort expressions',()=>{
  expect(migration).toContain("chosen as materialized (");
  expect(migration).toContain("final_pos int:=position('chosen as materialized ('");
  expect(migration).toContain('THEN RAISE EXCEPTION');
  expect(migration).toContain("nullif(x.vals->'cells'->>p_sort,'?') end asc nulls last");
  expect(migration).toContain("nullif(x.vals->'cells'->>p_sort,'?') end desc nulls last");
  expect(migration).toContain("numeric end desc nulls last");
 });
 it('orders existing invoices before missing values in both directions without losing monetary rows',async()=>{
  const db=await PGlite.create();
  try{
   await db.exec(`CREATE TABLE trips(id int PRIMARY KEY,trip_no text,invoice_no text,customer_due numeric);
    INSERT INTO trips VALUES
      (1,'1001','INV-02',100),(2,'1002','?',0),
      (3,'1003','INV-01',200),(4,'1004',NULL,300),
      (5,'1005','INV-10',400);`);
   const ordered=async(direction:'asc'|'desc')=>{
    const result=await db.query<{ids:number[];due:string}>(`
      SELECT array_agg(id ORDER BY NULLIF(invoice_no,'?') ${direction} NULLS LAST,trip_no DESC,id) ids,
             sum(customer_due)::text due FROM trips`);
    return result.rows[0];
   };
   const asc=await ordered('asc');
   const desc=await ordered('desc');
   expect(asc?.ids).toEqual([3,1,5,4,2]);
   expect(desc?.ids).toEqual([5,1,3,4,2]);
   expect(asc?.due).toBe('1000');
   expect(desc?.due).toBe(asc?.due);
  }finally{await db.close()}
 });
});