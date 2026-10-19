import {describe,expect,it} from 'vitest';
import {parseGeneralExpenseImport} from './generalExpenseImport';
const suppliers=[{id:'supplier',name:'Supplier One'}];
const accounts=[{id:'expense',name:'Repairs'}];
const row=(changes:Record<string,unknown>={})=>({
 'Invoice Group':'EXP-1','Supplier Invoice No':'INV-001','Date':'19-Oct-26',
 'Supplier':'Supplier One','Expense Account':'Repairs','Description':'Truck repair','Amount':'100','VAT Treatment':'With VAT',...changes
});
describe('General Expense Invoice Excel import',()=>{
 it('maps VAT and account without any Trip data',()=>{
  const result=parseGeneralExpenseImport([row(),row({'Description':'Labour','Amount':'25'})],suppliers,accounts);
  expect(result).toHaveLength(2);
  expect(result[0]).toMatchObject({supplier_id:'supplier',account_id:'expense',vat_choice:'with_vat',invoice_date:'2026-10-19',amount:'100'});
  expect(result.some(x=>'trip_no' in x)).toBe(false);
 });
 it('supports without-VAT supplier expenses',()=>{
  const result=parseGeneralExpenseImport([row({'VAT Treatment':'Without VAT'})],suppliers,accounts);
  expect(result[0].vat_choice).toBe('without_vat');
 });
 it('rejects missing Master accounts or inconsistent group VAT',()=>{
  expect(()=>parseGeneralExpenseImport([row({'Supplier':'Other'})],suppliers,accounts)).toThrow(/Masters/);
  expect(()=>parseGeneralExpenseImport([row(),row({'VAT Treatment':'Without VAT'})],suppliers,accounts)).toThrow(/conflicting/);
 });
 it('requires original Supplier invoice, positive amount and valid VAT label',()=>{
  expect(()=>parseGeneralExpenseImport([row({'Supplier Invoice No':''})],suppliers,accounts)).toThrow(/original/);
  expect(()=>parseGeneralExpenseImport([row({'Amount':'0'})],suppliers,accounts)).toThrow(/positive/);
  expect(()=>parseGeneralExpenseImport([row({'VAT Treatment':'Unknown'})],suppliers,accounts)).toThrow(/VAT Treatment/);
 });
});