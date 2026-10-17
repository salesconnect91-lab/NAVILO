import {describe,it,expect} from 'vitest';
import {previewVehicleExpenseImport} from './vehicleExpenseImport';

const row=(overrides:Record<string,unknown>={})=>({
 'Expense Group':'EXP-001','Expense Date':'2026-10-17','Supplier or Payee':'Supplier A',
 'Expense Type':'Diesel','Description':'Vehicle expense','Vehicle Number':'5731',
 'Trip No (Optional)':'','Net Amount SAR':'800','VAT Rate %':'0',
 'Payment Method':'Bank','Source Reference':'REF-001',...overrides
});
describe('Transport vehicle expense upload preview',()=>{
 it('accepts multiple vehicles and mixed taxable/exempt lines in one document',()=>{
  const lines=previewVehicleExpenseImport([row(),row({'Vehicle Number':'4821','Net Amount SAR':'1200','VAT Rate %':'15','Source Reference':'REF-002'})]);
  expect(lines).toHaveLength(2);
  expect(lines.map(x=>x.gross_amount)).toEqual(['800.00','1380.00']);
  expect(lines.map(x=>x.vat_amount)).toEqual(['0.00','180.00']);
 });
 it('supports vehicle-only expenses without a Trip',()=>{
  expect(previewVehicleExpenseImport([row()])[0].trip_no).toBeNull();
 });
 it('rejects duplicate references before any posting',()=>{
  expect(()=>previewVehicleExpenseImport([row(),row()])).toThrow(/repeated source reference/);
 });
 it('rejects payable without supplier',()=>{
  expect(()=>previewVehicleExpenseImport([row({'Payment Method':'Payable','Supplier or Payee':''})])).toThrow(/Payable requires Supplier/);
 });
 it('checks user-provided VAT and gross amounts',()=>{
  expect(()=>previewVehicleExpenseImport([row({'VAT Rate %':'15','VAT Amount SAR':'15'})])).toThrow(/VAT amount mismatch/);
  expect(()=>previewVehicleExpenseImport([row({'Gross Amount SAR':'799'})])).toThrow(/Gross amount mismatch/i);
 });
 it('rejects inconsistent dates in one document',()=>{
  expect(()=>previewVehicleExpenseImport([row(),row({'Expense Date':'2026-10-18','Source Reference':'REF-002'})])).toThrow(/document header differs/);
 });
 it('rejects invalid VAT rate and zero amount',()=>{
  expect(()=>previewVehicleExpenseImport([row({'VAT Rate %':'5'})])).toThrow(/VAT rate/);
  expect(()=>previewVehicleExpenseImport([row({'Net Amount SAR':'0'})])).toThrow(/positive/);
 });
 it('rejects invalid dates',()=>{
  expect(()=>previewVehicleExpenseImport([row({'Expense Date':'2026-02-30'})])).toThrow(/date/);
 });
});
