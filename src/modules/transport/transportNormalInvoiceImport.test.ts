import {describe,it,expect} from 'vitest';
import {parseNormalInvoiceImport} from './transportNormalInvoiceImport';
const people=[{id:'11111111-1111-1111-1111-111111111111',name:'Example Co'},{id:'22222222-2222-2222-2222-222222222222',name:'Supplier Co'}];
const account='33333333-3333-3333-3333-333333333333';
const cars=[{id:'44444444-4444-4444-4444-444444444444',vehicle_no:'1631'},{id:'55555555-5555-5555-5555-555555555555',vehicle_no:'2442'}];
const row=(changes:Record<string,unknown>={})=>({
 'Invoice Group':'INV-001','Invoice No':'ORIGINAL-01','Date':'17-Oct-26',
 'Customer':'Example Co','Description':'Independent service','Vehicle No':'1631','Amount':300,'Reference':'REF-9',...changes
});
describe('Transport normal Sales/Purchase import lines',()=>{
 it('maps one invoice with multiple description rows and no Trip required',()=>{
  const rows=parseNormalInvoiceImport([row(),row({'Description':'Second line','Amount':40})],'customer',people,account,cars);
  expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({invoice_date:'2026-10-17',party_id:people[0].id,account_id:account,amount:'300',invoice_no:'ORIGINAL-01'});
  expect(rows.every(x=>!('trip_no' in x))).toBe(true);
  expect(rows.every(x=>x.vehicle_id===cars[0].id)).toBe(true);
 });
 it('rejects Normal Sale import rows missing valid company-owned Vehicle Master number',()=>{
  expect(()=>parseNormalInvoiceImport([row({'Vehicle No':''})],'customer',people,account,cars)).toThrow(/Vehicle Number/);
  expect(()=>parseNormalInvoiceImport([row({'Vehicle No':'SUPPLIER-ONLY'})],'customer',people,account,cars)).toThrow(/Vehicle Number/);
  const rows=parseNormalInvoiceImport([row(),row({'Vehicle No':'2442','Amount':'50'})],'customer',people,account,cars);
  expect(rows.map(x=>x.vehicle_id)).toEqual(cars.map(x=>x.id));
 });
 it('maps supplier against Supplier Master independently of Customer Master',()=>{
  const input={'Invoice Group':'P-1','Invoice No':'P-100','Date':'2026-10-17','Supplier':'Supplier Co','Description':'Materials service','Amount':'45.25'};
  const parsed=parseNormalInvoiceImport([input],'supplier',people,account);
  expect(parsed[0].party_id).toBe(people[1].id);
 });
 it('refuses a party missing or duplicated in current company',()=>{
  expect(()=>parseNormalInvoiceImport([row({'Customer':'Other company'})],'customer',people,account,cars)).toThrow(/Master/);
  expect(()=>parseNormalInvoiceImport([row()],'customer',[...people,people[0]],account)).toThrow(/Master/);
 });
 it('requires accurate invoice grouping',()=>{
  expect(()=>parseNormalInvoiceImport([row(),row({'Invoice No':'OTHER'})],'customer',people,account,cars)).toThrow(/inconsistent/);
  expect(()=>parseNormalInvoiceImport([row(),row({'Invoice Group':'INV-002'})],'customer',people,account,cars)).toThrow(/two different/);
 });
 it('rejects invalid amount, description or date before posting',()=>{
  expect(()=>parseNormalInvoiceImport([row({'Amount':'0'})],'customer',people,account,cars)).toThrow(/positive Amount/);
  expect(()=>parseNormalInvoiceImport([row({'Amount':'1.234'})],'customer',people,account,cars)).toThrow(/positive Amount/);
  expect(()=>parseNormalInvoiceImport([row({'Description':''})],'customer',people,account,cars)).toThrow(/Description/);
  expect(()=>parseNormalInvoiceImport([row({'Date':'wrong'})],'customer',people,account,cars)).toThrow(/Invalid date/);
 });
 it('caps number of rows and documents',()=>{
  expect(()=>parseNormalInvoiceImport(Array.from({length:201},()=>row()),'customer',people,account,cars)).toThrow(/1–200/);
  expect(()=>parseNormalInvoiceImport(Array.from({length:51},(_,i)=>row({'Invoice Group':String(i),'Invoice No':'INV'+i})),'customer',people,account,cars)).toThrow(/50/);
 });
});
