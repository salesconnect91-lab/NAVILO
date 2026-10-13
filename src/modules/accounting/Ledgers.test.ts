// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
vi.mock('@/lib/supabase',()=>({supabase:{}}));
import {buildTransportLedgerContext,excludeOwnerCancelledLedgerRows} from './Ledgers';
it('keeps customer and supplier invoice numbers separate and counts document charges once across trips',()=>{
 const lookup=buildTransportLedgerContext([
  {side:'customer',order_no:'INV-1',trip_no:'C1',charge_amount:10,total_amount:110},
  {side:'customer',order_no:'INV-1',trip_no:'C2',charge_amount:10,total_amount:110},
  {side:'supplier',order_no:'INV-1',trip_no:'S1',charge_amount:25,total_amount:225},
 ],[{side:'customer',order_no:'INV-1',journal_entry_id:'customer-je'},{side:'supplier',order_no:'INV-1',journal_entry_id:'supplier-je'}]);
 const customer=lookup({party_type:'customer',reference:'INV-1',journal_entry_id:'customer-je'} as any);
 expect(customer.trip).toBe('C1 / C2');expect(customer.charges).toBe(10);expect(customer.postedTotal).toBe(110);
 const supplier=lookup({party_type:'supplier',reference:'INV-1',journal_entry_id:'supplier-je'} as any);
 expect(supplier.trip).toBe('S1');expect(supplier.charges).toBe(25);expect(supplier.postedTotal).toBe(225);
 expect(lookup({journal_entry_id:'supplier-je'} as any).charges).toBe(25);
});

it('excludes owner-cancelled original and reversal from normal GL, party statements, totals and print/export sources',()=>{
 const rows=[
  {id:'opening',journal_entry_id:'opening-je',debit:133428.66,credit:0},
  {id:'original',journal_entry_id:'JE-48367409',debit:0,credit:16665.53},
  {id:'reversal',journal_entry_id:'OWNER-REV-JE-48367409',debit:16665.53,credit:0},
  {id:'unrelated',journal_entry_id:'other-je',debit:10,credit:0},
  {id:'unlinked',journal_entry_id:null,debit:5,credit:0},
 ];
 const visible=excludeOwnerCancelledLedgerRows(rows,new Set(['JE-48367409','OWNER-REV-JE-48367409']));
 expect(visible.map(x=>x.id)).toEqual(['opening','unrelated','unlinked']);
 expect(visible.reduce((n,x)=>n+x.debit-x.credit,0)).toBeCloseTo(133443.66);
 expect(excludeOwnerCancelledLedgerRows(rows,new Set())).toBe(rows);
});

it('links imported shared cutover rows to the correct party and keeps source totals out of posted invoice columns',()=>{
 const lookup=buildTransportLedgerContext([
  {side:'customer',party_id:'a',order_id:'oa',order_no:'INV-1',trip_no:'101',kind:'opening_balance',base_amount:100,tax_amount:15,total_amount:115},
  {side:'customer',party_id:'b',order_id:'ob',order_no:'INV-1',trip_no:'202',kind:'opening_balance',base_amount:200,tax_amount:30,total_amount:230},
 ],[{side:'customer',party_id:'a',order_id:'oa',order_no:'INV-1',journal_entry_id:'cutover'},
 {side:'customer',party_id:'b',order_id:'ob',order_no:'INV-1',journal_entry_id:'cutover'}]);
 const a=lookup({party_type:'customer',party_id:'a',journal_entry_id:'cutover'} as any);
 expect(a.trip).toBe('101');expect(a.documentRefs).toBe('INV-1');expect(a.postedTotal).toBe(0);expect(a.tax).toBe(0);
 expect(lookup({party_type:'customer',party_id:'b',journal_entry_id:'cutover'} as any).trip).toBe('202');
 expect(lookup({journal_entry_id:'cutover'} as any).trip).toBe('');
});

it('matches native document IDs when a legacy detail DTO has no party field',()=>{
 const lookup=buildTransportLedgerContext([{side:'customer',order_id:'native-1',order_no:'SALE-1',trip_no:'N1',total_amount:115}],
 [{side:'customer',party_id:'party-1',order_id:'native-1',order_no:'SALE-1',journal_entry_id:'native-je'}]);
 expect(lookup({party_type:'customer',party_id:'party-1',journal_entry_id:'native-je'} as any).trip).toBe('N1');
});
