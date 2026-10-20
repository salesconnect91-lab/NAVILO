import {describe,expect,it} from 'vitest';
import {draftInvoicePreviewTotals} from './invoiceDraftPreview';
describe('read-only Sales draft totals',()=>{
 it('shows saved service lines and VAT even when the stored invoice header is zero',()=>{
  const result=draftInvoicePreviewTotals([
   {order_id:'orbit-draft',amount:'2900',tax_percent:'15'},
   {order_id:'orbit-draft',amount:'700',tax_percent:'15'},
  ],[]);
  expect(result.get('orbit-draft')).toBe(4140);
 });
 it('preserves historical VAT and includes saved invoice charges exactly once',()=>{
  const result=draftInvoicePreviewTotals([
   {order_id:'historical',amount:'100',tax_percent:'15',historical_vat_amount:'10'},
  ],[{order_id:'historical',amount:'25',tax_percent:'15'}]);
  expect(result.get('historical')).toBe(138.75);
 });
 it('does not create imaginary totals for invoices without saved lines',()=>{
  expect(draftInvoicePreviewTotals([],[]).size).toBe(0);
 });
});
