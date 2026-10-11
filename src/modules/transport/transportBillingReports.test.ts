import {describe,it,expect} from 'vitest';
import {billingReport,hasOnlyWithoutVatDocuments} from './transportBillingReports';
const report={title:'Transport',description:'',columns:['Document','Net after credits','VAT after credits','Gross after credits','Document VAT','Outstanding gross'],rows:[['B-1',100,0,100,0,70],['TOTAL',100,0,100,0,70]]};
describe('Transport VAT report projection',()=>{
 it('hides every VAT column in a without-VAT report and preserves amounts and totals',()=>{
  const r=billingReport(report,true);expect(r.columns).toEqual(['Document','Amount after credits','Bill amount','Outstanding amount']);expect(r.rows).toEqual([['B-1',100,100,70],['TOTAL',100,100,70]]);
 });
 it('retains VAT columns for mixed and historical taxable documents',()=>{
  expect(hasOnlyWithoutVatDocuments([{original_net:100,original_gross:100},{original_net:100,original_gross:115}])).toBe(false);expect(billingReport(report,false)).toBe(report);
 });
 it('decides visibility from invoice history rather than the current master rule',()=>{
  expect(hasOnlyWithoutVatDocuments([{original_net:100,original_gross:100}])).toBe(true);expect(hasOnlyWithoutVatDocuments([])).toBe(false);
 });
});
