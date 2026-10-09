// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
vi.mock('@/lib/supabase',()=>({supabase:{}}));
import {buildTransportLedgerContext} from './Ledgers';
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
