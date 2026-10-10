import {describe,it,expect} from 'vitest';
import {parseExternalInvoiceRows} from './transportExternalInvoiceImport';
const row={'TRIP NO.':16512,DATE:'2026-06-04','Invoice / Bill Date':'31-Aug-26',INVOICED:'2026-03098','COMPANY NAME':'ENERCO','PLATE #':7979,'RATE WITH COMPANY':3000,'TAX (%)':15,'TAX AMOUNT':450,'BILL AMOUNT':3450,'Cash/Credit':'Credit',Discription:'Delivery'};
describe('external invoice import',()=>{
 it('preserves invoice dates independently of source trip dates and supports multiple vehicles',()=>{const rows=parseExternalInvoiceRows([row,{...row,'TRIP NO.':16521,'PLATE #':5731,DATE:'2026-06-05'}]);expect(rows.map(r=>r.invoice_no)).toEqual(['2026-03098','2026-03098']);expect(rows[0].invoice_date).toBe('2026-08-31');expect(rows[0].reference_date).toBe('2026-06-04');expect(rows[1].vehicle_no).toBe('5731');});
 it('treats CLEARED as blank but retains Cash type without inventing a receipt',()=>{const rows=parseExternalInvoiceRows([{...row,INVOICED:'CLEARED ASAD','Cash/Credit':'Cash','TAX (%)':0,'TAX AMOUNT':0,'BILL AMOUNT':3000}]);expect(rows[0].invoice_no).toBe('');expect(rows[0].sale_type).toBe('Cash');expect(rows[0]).not.toHaveProperty('paid_amount');});
 it('rejects inconsistent invoice headers, duplicates, missing dates and wrong source totals',()=>{
 expect(()=>parseExternalInvoiceRows([row,{...row,'TRIP NO.':99,'COMPANY NAME':'Other'}])).toThrow('same Customer');
 expect(()=>parseExternalInvoiceRows([row,row])).toThrow('duplicate source');
 expect(()=>parseExternalInvoiceRows([{...row,'Invoice / Bill Date':''}])).toThrow('Invoice / Bill Date');
 expect(()=>parseExternalInvoiceRows([{...row,'BILL AMOUNT':3000}])).toThrow('reconcile');
 });
});
