// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import GeneralExpenseBillCreate from './GeneralExpenseBillCreate';
const mock=vi.hoisted(()=>({calls:[] as any[],error:false}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'company-1'},activeBusinessUnit:{business_unit_id:'bu-1'}})}));
vi.mock('@/components/NaviloDateInput',()=>({default:({value,onChange,...props}:any)=><input {...props} type="date" value={value} onChange={onChange}/>}));
vi.mock('@/components/SearchableSelect',()=>({default:({children,nativeCompatibility,preserveLabel,...props}:any)=><select {...props}>{children}</select>}));
vi.mock('@/lib/effectiveTaxRate',()=>({fixedTaxRateOn:async()=>15}));
vi.mock('@/lib/supabase',()=>({supabase:{
 from:(name:string)=>{
  const rows=name==='suppliers'?[{id:'supplier-1',name:'Test Supplier'}]:
    name==='chart_of_accounts'?[{id:'expense-1',name:'Repairs Expense'}]:[];
  const q:any={select:()=>q,eq:()=>q,order:()=>q,then:(resolve:any)=>Promise.resolve({data:rows,error:null}).then(resolve)};
  return q;
 },
 rpc:async(name:string,args:any)=>{
  mock.calls.push({name,args});
  if(mock.error)return {data:null,error:{message:'Permission denied'}};
  return {data:{document_id:'doc-1',invoice_no:'EXP-1',gross:115,status:args.p_post?'posted':'draft'},error:null};
 }
}}));
beforeEach(()=>{mock.calls=[];mock.error=false});afterEach(cleanup);
async function fill(){
 render(<MemoryRouter><GeneralExpenseBillCreate/></MemoryRouter>);
 await waitFor(()=>expect(screen.getByRole('option',{name:'Test Supplier'})).toBeTruthy());
 fireEvent.change(screen.getByLabelText('Expense invoice supplier'),{target:{value:'supplier-1'}});
 fireEvent.change(screen.getByLabelText('Expense supplier invoice number'),{target:{value:'SUP-001'}});
 fireEvent.change(screen.getByLabelText('Expense invoice account'),{target:{value:'expense-1'}});
 fireEvent.change(screen.getByLabelText('Expense description 1'),{target:{value:'Vehicle repairs'}});
 fireEvent.change(screen.getByLabelText('Expense amount 1'),{target:{value:'100'}});
}
describe('General Expense Bill non-inventory workflow',()=>{
 it('creates a draft with no VAT and no posting action',async()=>{
  await fill();
  fireEvent.click(screen.getByRole('button',{name:'Save Draft'}));
  await screen.findByText(/Expense Invoice draft/);
  expect(mock.calls).toHaveLength(1);
  expect(mock.calls[0].name).toBe('general_expense_bill_create');
  expect(mock.calls[0].args).toEqual(expect.objectContaining({
    p_vat:false,p_post:false,p_supplier:'supplier-1',p_account:'expense-1',p_supplier_invoice_no:'SUP-001'
  }));
 });
 it('posts with VAT only through the controlled supplier bill RPC',async()=>{
  await fill();
  fireEvent.change(screen.getByLabelText('Expense invoice VAT treatment'),{target:{value:'yes'}});
  await screen.findByText(/VAT:.*SAR 15\.00/);
  fireEvent.click(screen.getByRole('button',{name:'Post Expense Invoice'}));
  await screen.findByText(/Expense Invoice posted/);
  expect(mock.calls[0].args.p_vat).toBe(true);
  expect(mock.calls[0].args.p_post).toBe(true);
 });
 it('never presents a false success on denied posting',async()=>{
  await fill();mock.error=true;
  fireEvent.click(screen.getByRole('button',{name:'Post Expense Invoice'}));
  expect((await screen.findByRole('alert')).textContent).toContain('Permission denied');
  expect(screen.queryByText(/Expense Invoice posted/)).toBeNull();
 });
});
