import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function runTransportConcurrency(db, Client) {
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.NAVILO_NATIVE_REHEARSAL!=='1')throw new Error('Concurrency requires the isolated CI PostgreSQL service');
  const name=await db.query('select current_database() name');
  if(name.rows[0].name!=='navilo_transport_rehearsal')throw new Error('Unexpected database');
  await db.exec(fs.readFileSync(new URL('./transport_release_concurrency_fixture.sql',import.meta.url),'utf8'));
  const {data:f}= (await db.query('select data from transport_rehearsal.fixture')).rows[0];
  const clients=await Promise.all([0,1].map(async()=>{
    const c=new Client({host:'127.0.0.1',port:6543,user:'postgres',password:'navilo-rehearsal-only',database:'navilo_transport_rehearsal'});
    await c.connect();await c.query("select set_config('request.jwt.claim.sub',$1,false)",[f.user]);
    await c.query("set jit=off;set statement_timeout='30s';set role authenticated");return c;
  }));
  const pair=(sql,args)=>Promise.allSettled(clients.map((c,i)=>c.query(sql,typeof args==='function'?args(i):args)));
  try {
    const created=await pair('select public.transport_create_trips($1,$2,$3,$4::jsonb) result',()=>[randomUUID(),f.company,f.unit,JSON.stringify(f.payload)]);
    assert(created.every(r=>r.status==='fulfilled'),'Concurrent Trip creators failed');
    const trips=created.map(r=>r.value.rows[0].result[0]);assert.notEqual(trips[0].trip_no,trips[1].trip_no);
    const costId=randomUUID();
    const costs=await pair('select public.transport_post_cost_request($1,$2,$3,$4,$5,$6,$7,false,$8) result',[costId,f.trip,'other',f.supplier,25,f.date,f.account,'CONCURRENT-INTENT']);
    assert(costs.every(r=>r.status==='fulfilled'),'Same-intent concurrent retry failed');
    assert.deepEqual(costs[0].value.rows[0].result,costs[1].value.rows[0].result);
    assert.equal((await db.query('select count(*)::integer n from transport_service_cost_links where trip_id=$1',[f.trip])).rows[0].n,1);
    for(const [sql,args,table,key,id] of [
      ['select public.transport_post_customer_bill($1,$2,false)',[f.trip,f.date],'transport_customer_document_trips','trip_id',f.trip],
      ['select public.transport_post_supplier_bill($1,$2,$3,false)',[f.rent,f.date,f.account],'transport_supplier_document_rents','rent_id',f.rent],
    ]){
      const results=await pair(sql,args);assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'Posting race must produce one successful original');
      assert.equal((await db.query(`select count(*)::integer n from ${table} where ${key}=$1 and not is_adjustment`,[id])).rows[0].n,1);
    }
    const bill=(await db.query('select d.sales_order_id id from transport_customer_document_trips l join transport_customer_documents d on d.id=l.document_id where l.trip_id=$1 and not l.is_adjustment',[f.trip])).rows[0].id;
    const allocations=JSON.stringify([{document_id:bill,amount:1000}]);const settlementId=randomUUID();
    const settled=await pair('select public.transport_settle_reviewed_documents($1,$2,$3,$4,$5,$6,$7::jsonb,$8) result',[settlementId,'customer',f.customer,f.date,f.cash,'cash',allocations,'CONCURRENT-PAY']);
    assert(settled.every(r=>r.status==='fulfilled'),'Settlement same-intent retry failed');assert.deepEqual(settled[0].value.rows[0].result,settled[1].value.rows[0].result);
    await clients[0].query('select public.transport_post_customer_bill($1,$2,false)',[f.trip2,f.date]);
    const bill2=(await db.query('select d.sales_order_id id from transport_customer_document_trips l join transport_customer_documents d on d.id=l.document_id where l.trip_id=$1 and not l.is_adjustment',[f.trip2])).rows[0].id;
    const competing=await pair('select public.transport_settle_reviewed_documents($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',()=>[randomUUID(),'customer',f.customer,f.date,f.cash,'cash',JSON.stringify([{document_id:bill2,amount:1000}]),'COMPETING-PAY']);
    assert.equal(competing.filter(r=>r.status==='fulfilled').length,1,'Competing full settlements must not overpay');
    const assigned=await pair('select public.transport_replace_trip_assignment($1,$2,null,$3)',i=>[f.trip,i?f.vehicle2:f.vehicle,'Concurrent replacement']);
    assert(assigned.every(r=>r.status==='fulfilled'),'Assignment fallback/history race failed');
    assert.equal((await db.query('select count(*)::integer n from transport_trip_assignments where trip_id=$1 and ended_at is null',[f.trip])).rows[0].n,1);
    assert.equal((await db.query('select count(*)::integer n from transport_trip_assignments where trip_id=$1 and effective_at is null',[f.trip])).rows[0].n,0);
    console.log('PASS native concurrent creators, expense intent, customer/supplier posting, same/competing settlement and assignment replacement');
  } finally {await Promise.all(clients.map(c=>c.end()));}
}
