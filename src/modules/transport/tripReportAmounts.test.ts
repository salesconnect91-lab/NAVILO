import {describe,it,expect} from 'vitest';
import {tripAmounts,tripAmountKeys} from './tripReportAmounts';
import {reportCellText} from './transportPartyExport';
describe('Trip report financial amounts',()=>{
 it('converts PostgreSQL numbers and keeps gross receipts, credits and posted net contribution separate',()=>{
  const values=tripAmounts({billed_customer_net:'1900.00',billed_supplier_net:'900.00',driver_accrued:'100',other_cost_net:'50',customer_received_gross:'1180',supplier_paid_gross:'1000',supplier_credit_gross:'100'});
  expect(values[tripAmountKeys.indexOf('profit')]).toBe(850);
  expect(values[tripAmountKeys.indexOf('customer_received_gross')]).toBe(1180);
  expect(values[tripAmountKeys.indexOf('supplier_credit_gross')]).toBe(100);
 });
 it('uses server totals rather than page rows and weights total margin by full revenue',()=>{
  const values=tripAmounts({revenue:50000,profit:10000,billed_supplier_net:40000,customer_received_gross:20000},true);
  expect(values[tripAmountKeys.indexOf('billed_customer_net')]).toBe(50000);
  expect(values[tripAmountKeys.indexOf('margin')]).toBe(20);
  expect(reportCellText(1900)).toBe('1,900.00');expect(reportCellText('005')).toBe('005');
 });
});
