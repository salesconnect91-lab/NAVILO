// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import Expenses from './TransportVehicleExpenses';
const mock=vi.hoisted(()=>({calls:[] as any[],deny:false}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'c'},activeBusinessUnit:{business_unit_id:'b'}})}));
vi.mock('@/components/NaviloDateInput',()=>({default:({value,onChange}:any)=><input type="date" value={value} onChange={onChange}/>}));
vi.mock('@/lib/supabase',()=>({supabase:{from:(table:string)=>{const data=table==='transport_vehicles'?[{id:'v1',vehicle_no:'7979'}]:table==='transport_vehicle_expense_types'?[{id:'t1',name:'Fuel'}]:table==='transport_vehicle_ownership'?[{id:'o1',vehicle_id:'v1',owner_type:'company',effective_from:'2020-01-01',effective_to:null}]:table==='chart_of_accounts'?[{id:'expense',name:'Fuel GL',type:'expense',is_group:false},{id:'bank',name:'Bank',type:'asset',is_group:false,detail_type:'Bank Account'}]:table==='transport_vehicle_expense_documents'?[{id:'draft-1',expense_group:'FUEL-1',expense_date:'2026-10-17',payment_method:'bank',payment_account_id:'bank',supplier_id:null,status:'draft',journal_entry_id:null}]:table==='transport_vehicle_expense_document_lines'?[{id:'line-1',vehicle_id:'v1',trip_id:null,expense_type:'Fuel',description:'Fuel receipt',expense_account_id:'expense',source_reference:'REF-001',vat_recoverable:true,net_amount:100,vat_rate:15}]:[];const q:any={select:()=>q,eq:()=>q,order:()=>q,range:()=>Promise.resolve({data,error:null}),then:(resolve:any,reject:any)=>Promise.resolve({data,error:null}).then(resolve,reject)};return q;},rpc:async(name:string,args:any)=>{mock.calls.push({name,args});if(mock.deny)return {data:null,error:{message:'Posting permission required'}};return {data:{document_id:'draft-1',journal_entry_id:'je-1',status:name.endsWith('_post')?'posted':'draft'},error:null};}}}));
beforeEach(()=>{mock.calls=[];mock.deny=false});afterEach(cleanup);
describe('Vehicle expense workflow',()=>{
 it('reviews and posts existing expense draft without duplicate posting',async()=>{
  render(<MemoryRouter><Expenses/></MemoryRouter>);
  expect(await screen.findByText('Vehicle Expense Bills & Import Review')).toBeTruthy();
  expect(screen.getByRole('button',{name:/New Expense Bill/})).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Save Draft / Changes'})).toBeNull();
  expect(screen.getByText(/Do not create VAT expense bills in General Journal/)).toBeTruthy();
  fireEvent.click(await screen.findByRole('button',{name:'Open / Review'}));
  await screen.findByLabelText('Expense vehicle 1');
  fireEvent.change(screen.getByLabelText('Expense net 1'),{target:{value:'200'}});
  fireEvent.click(screen.getByRole('button',{name:'Save Draft / Changes'}));
  await screen.findByText('Expense draft saved. Review all lines before posting.');
  expect(mock.calls[0]).toEqual(expect.objectContaining({name:'transport_vehicle_expense_save',args:expect.objectContaining({p_id:'draft-1'})}));
  expect(mock.calls[0].args.p_document.lines[0]).toEqual(expect.objectContaining({vehicle_id:'v1',net_amount:'200',vat_rate:'15',vat_recoverable:true}));
  fireEvent.click(screen.getByRole('button',{name:'Finalize / Post'}));
  await screen.findByText('Expense posted once to GL and vehicle accounts.');
  expect(mock.calls.filter(x=>x.name==='transport_vehicle_expense_post')).toEqual([{name:'transport_vehicle_expense_post',args:{p_id:'draft-1'}}]);
  expect(screen.queryByRole('button',{name:'Finalize / Post'})).toBeNull();
 });
 it('creates a new manual expense bill as DRAFT only, without directly posting accounting',async()=>{
  render(<MemoryRouter><Expenses/></MemoryRouter>);
  await screen.findByText('Vehicle Expense Bills & Import Review');
  await waitFor(()=>expect(screen.getByRole('button',{name:/New Expense Bill/}).hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:/New Expense Bill/}));
  await screen.findByLabelText('Expense vehicle 1');
  expect(screen.getByRole('button',{name:'Finalize / Post'}).hasAttribute('disabled')).toBe(true);
  fireEvent.change(screen.getByLabelText('Document Reference *'),{target:{value:'FUEL-NEW-01'}});
  fireEvent.change(screen.getByLabelText('Expense net 1'),{target:{value:'100'}});
  fireEvent.click(screen.getByRole('button',{name:'Save Draft / Changes'}));
  await screen.findByText('Expense draft saved. Review all lines before posting.');
  expect(mock.calls).toHaveLength(1);
  expect(mock.calls[0]).toEqual(expect.objectContaining({
    name:'transport_vehicle_expense_save',
    args:expect.objectContaining({p_id:null,p_document:expect.objectContaining({expense_group:'FUEL-NEW-01'})})
  }));
  expect(mock.calls[0].args.p_document.lines[0]).toEqual(expect.objectContaining({net_amount:'100',vat_rate:'0'}));
  expect(mock.calls.some(x=>x.name==='transport_vehicle_expense_post')).toBe(false);
 });
 it('does not claim posting success if imported draft update is denied',async()=>{
  render(<MemoryRouter><Expenses/></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button',{name:'Open / Review'}));
  await screen.findByLabelText('Expense vehicle 1');
  mock.deny=true;
  fireEvent.click(screen.getByRole('button',{name:'Save Draft / Changes'}));
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('permission'));
  expect(screen.queryByText('Expense draft saved. Review all lines before posting.')).toBeNull();
 });

});
