import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';

const migration = readFileSync(
  'supabase/migrations/20261015161000_transport_register_date_filter_pushdown.sql',
  'utf8',
);

describe('Transport Register date-filter pushdown',()=>{
  it('preserves both inclusive bounds and refuses an unknown source function',()=>{
    expect(migration).toContain("p_filters->>'fromDate'");
    expect(migration).toContain("p_filters->>'toDate'");
    expect(migration).toContain('t.trip_date>=');
    expect(migration).toContain('t.trip_date<=');
    expect(migration).toContain('matches<>1');
    expect(migration).toContain('Canonical downstream date filter missing');
  });

  it('returns identical filtered Trip identities and money totals with earlier date selection',async()=>{
    const db=await PGlite.create();
    try{
      await db.exec(`
        CREATE TABLE trips(id integer PRIMARY KEY, trip_date date, eligible boolean);
        CREATE TABLE finance(trip_id integer, customer_due numeric, supplier_due numeric);
        INSERT INTO trips VALUES
          (1,'2026-08-31',true),(2,'2026-09-01',true),
          (3,'2026-09-15',false),(4,'2026-09-30',true),
          (5,'2026-10-01',true),(6,'2026-09-18',true);
        INSERT INTO finance VALUES
          (1,100,40),(2,240,80),(3,999,999),
          (4,300,100),(5,130,60),(6,0,25);
      `);
      const late = `
        SELECT t.id,f.customer_due,f.supplier_due
        FROM trips t JOIN finance f ON f.trip_id=t.id
        WHERE t.eligible AND t.trip_date>='2026-09-01'
          AND t.trip_date<='2026-09-30' ORDER BY t.id`;
      const early = `
        WITH eligible_ids AS MATERIALIZED (
          SELECT id FROM trips t WHERE eligible
          AND t.trip_date>='2026-09-01'
          AND t.trip_date<='2026-09-30'
        )
        SELECT t.id,f.customer_due,f.supplier_due
        FROM eligible_ids t JOIN finance f ON f.trip_id=t.id ORDER BY t.id`;
      const oldRows=(await db.query(late)).rows;
      const newRows=(await db.query(early)).rows;
      expect(newRows).toEqual(oldRows);
      expect(newRows.map(r=>r.id)).toEqual([2,4,6]);
      const total=(rows:Record<string,unknown>[])=>rows.reduce((sum,r)=>sum+Number(r.customer_due)+Number(r.supplier_due),0);
      expect(total(newRows)).toBe(745);
      expect(total(newRows)).toBe(total(oldRows));
    }finally{await db.close()}
  });
});
