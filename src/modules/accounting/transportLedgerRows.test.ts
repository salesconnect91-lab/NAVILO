import {expect,it} from 'vitest';
import {detailedTransportLedger,partySearchKey} from './transportLedgerRows';
const anchor=(override={})=>({id:'ledger',party_type:'supplier',party_id:'p',journal_entry_id:'opening',entry_date:'2026-10-12',created_at:'2026-10-12',debit:0,credit:100,...override} as any);
const event=(override={})=>({event_id:'one',kind:'opening_balance',event_type:'opening_balance',order_id:'d1',order_no:'INV1',side:'supplier',party_id:'p',party_name:'BARI',journal_entry_id:'opening',event_date:'2026-10-12',created_at:'2026-10-12',debit:0,credit:100,amount:100,original_gross:300,historical_settled:200,...override} as any);
it('expands a mixed debit/credit voucher by invoice and preserves both totals, without duplicate events',()=>{
 const es=[event({credit:120}),event({event_id:'two',order_id:'d2',debit:20,credit:0,amount:-20})];
 const result=detailedTransportLedger([anchor({credit:120}),anchor({id:'credit-source',debit:20,credit:0})],[...es,es[0]]);
 expect(result.unmatched).toEqual([]);expect(result.rows.map(r=>r.transport_order_id)).toEqual(['d1','d2']);expect(result.rows.reduce((n,r)=>n+r.debit,0)).toBe(20);expect(result.rows.reduce((n,r)=>n+r.credit,0)).toBe(120);
});
it('fails closed to original posting if invoice detail is incomplete or belongs to a different party',()=>{
 const row=anchor();const result=detailedTransportLedger([row],[event({credit:99}),event({party_id:'other',event_id:'other'})]);expect(result.rows).toEqual([row]);expect(result.unmatched).toContain('opening:supplier:p');
});
it('shows fully settled source invoices without inventing a ledger amount',()=>{
 const r=detailedTransportLedger([],[event({debit:0,credit:0,amount:0,original_gross:300,historical_settled:300})]).rows;
 expect(r).toHaveLength(1);expect(r[0].source_gross).toBe(300);expect(r[0].credit).toBe(0);expect(r[0].debit).toBe(0);
});
it('splits multi-trip invoices into bounded rows and counts invoice amounts once',()=>{
 const r=detailedTransportLedger([anchor()],[event()],[{side:'supplier',order_id:'d1',trip_no:'T1'},{side:'supplier',order_id:'d1',trip_no:'T2'}]).rows;
 expect(r.map(x=>x.transport_trip_no)).toEqual(['T1','T2']);expect(r.reduce((n,x)=>n+x.credit,0)).toBe(100);expect(r.reduce((n,x)=>n+(x.source_gross||0),0)).toBe(300);
});
it('leaves native ledger rows intact and matches typed names with spaces or hyphens',()=>{
 const row=anchor();expect(detailedTransportLedger([row],[event({kind:'invoice'})]).rows).toEqual([row]);expect(partySearchKey(' CASH-BARI ')).toBe(partySearchKey('Cash BARI'));
});
