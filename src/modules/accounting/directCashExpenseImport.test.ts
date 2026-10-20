import {describe,it,expect} from 'vitest';
import {parseDirectCashExpenseRows} from './directCashExpenseImport';
const accounts=[
 {id:'expense',name:'General Expenses',code:'6500',type:'expense',detail_type:'General Expense',is_active:true,is_group:false,allow_manual_entries:true},
 {id:'yard',name:'Yard Rent',code:'6202',type:'expense',detail_type:'Rent',is_active:true,is_group:false,allow_manual_entries:true},
 {id:'cash',name:'Cash',code:'1000',type:'asset',detail_type:'Cash on Hand',is_active:true,is_group:false,allow_manual_entries:true},
 {id:'bank',name:'Riyadh Bank',code:'1020',type:'asset',detail_type:'Bank Account',is_active:true,is_group:false,allow_manual_entries:true},
 {id:'ap',name:'Accounts Payable',code:'2100',type:'liability',detail_type:'Accounts Payable',is_active:true},
 {id:'cogs',name:'Cost of Goods Sold',code:'5100',type:'expense',detail_type:'COGS',is_active:true},
];
const row=(over:Record<string,unknown>={})=>({
 'Date':'2026-10-19','Area':'Office','Expense Account':'6500',
 'Cash / Bank Account':'Cash','Paid To':'Cash Shop','Description':'Stationery paid',
 'Amount SAR':'30.00','Source Reference':'OFC-001',...over
});
describe('supplier-less direct cash expenses Excel',()=>{
 it('maps exact company accounts and keeps paid-to text without a Supplier Master',()=>{
  const r=parseDirectCashExpenseRows([row()],accounts);
  expect(r).toEqual([{transaction_date:'2026-10-19',expense_area:'office',
   expense_account_id:'expense',cash_bank_account_id:'cash',
   paid_to:'Cash Shop',description:'Stationery paid',amount:30,source_reference:'OFC-001'}]);
 });
 it('supports yard expense via real bank account and separate dedicated GL',()=>{
  expect(parseDirectCashExpenseRows([row({'Area':'Yard','Expense Account':'Yard Rent',
   'Cash / Bank Account':'Riyadh Bank','Source Reference':'YRD-002'})],accounts)[0])
   .toMatchObject({expense_area:'yard',expense_account_id:'yard',cash_bank_account_id:'bank'});
 });
 it('does not silently create expense accounts, supplier balances or VAT lines',()=>{
  expect(()=>parseDirectCashExpenseRows([row({'Expense Account':'Office Fake'})],accounts)).toThrow(/Expense GL/);
  expect(()=>parseDirectCashExpenseRows([row({'Cash / Bank Account':'Accounts Payable'})],accounts)).toThrow(/Cash on Hand/);
  expect(()=>parseDirectCashExpenseRows([row({'Expense Account':'Cost of Goods Sold'})],accounts)).toThrow(/Expense GL/);
 });
 it('rejects duplicate references and invalid dates or amounts before any financial RPC',()=>{
  expect(()=>parseDirectCashExpenseRows([row(),row()],accounts)).toThrow(/duplicate source reference/);
  expect(()=>parseDirectCashExpenseRows([row({'Date':'2026-02-30'})],accounts)).toThrow(/valid ISO Date/);
  expect(()=>parseDirectCashExpenseRows([row({'Amount SAR':'-10.00'})],accounts)).toThrow(/positive SAR/);
  expect(()=>parseDirectCashExpenseRows([row({'Area':'Vehicle'})],accounts)).toThrow(/Vehicle Expense Excel/);
 });
 it('caps batches and allows blank free-text payee',()=>{
  expect(parseDirectCashExpenseRows([row({'Paid To':''})],accounts)[0].paid_to).toBe('');
  expect(()=>parseDirectCashExpenseRows(Array.from({length:101},(_,i)=>row({'Source Reference':'r'+i})),accounts)).toThrow(/100/);
 });
});
