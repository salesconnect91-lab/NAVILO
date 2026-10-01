// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportAdvanceOperations from './TransportAdvanceOperations';
const mock=vi.hoisted(()=>({rpc:vi.fn(),allowed:true,fail:false}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'c'},activeBusinessUnit:{business_unit_id:'b'}})}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc,from:(table:string)=>{
 const data:Record<string,unknown[]>={customers:[{id:'customer',name:'Customer'}],suppliers:[{id:'supplier',name:'Owner'}],chart_of_accounts:[{id:'cash',name:'Cash',detail_type:'Cash on Hand'}],transport_party_advances:[{journal_entry_id:'receipt',side:'customer',party_id:'customer',entry_no:'CR-1',entry_date:'2026-09-30',amount:500,allocated:0,available:500}],transport_party_documents:[{side:'customer',party_id:'customer',order_id:'bill',order_no:'INV-1',trip_no:'T-1',current_outstanding_gross:200}]};
 const q:any={};for(const m of ['select','eq','in','order','range'])q[m]=()=>q;q.then=(resolve:any)=>Promise.resolve({data:data[table]??[],error:null}).then(resolve);return q;
}}}));
beforeEach(()=>{mock.allowed=true;mock.fail=false;mock.rpc.mockReset();mock.rpc.mockImplementation(async(name:string)=>({data:name==='transport_finance_allowed'?mock.allowed:{success:true},error:name==='transport_manage_advance'&&mock.fail?{message:'Interrupted'}:null}))});afterEach(cleanup);
describe('Transport existing advance allocation',()=>{
 it('caps the allocation by the Trip bill and uses the original voucher without another cash account',async()=>{
 render(<TransportAdvanceOperations onChanged={async()=>{}}/>);await screen.findByRole('option',{name:'Customer'});
 fireEvent.change(screen.getByLabelText('Advance party'),{target:{value:'customer'}});fireEvent.change(screen.getByLabelText('Action'),{target:{value:'allocate'}});
 fireEvent.change(screen.getByLabelText('Existing advance'),{target:{value:'receipt'}});fireEvent.change(screen.getByLabelText('Trip bill'),{target:{value:'bill'}});
 fireEvent.change(screen.getByLabelText('Advance amount'),{target:{value:'201'}});expect((screen.getByRole('button',{name:'Review advance'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.change(screen.getByLabelText('Advance amount'),{target:{value:'150'}});fireEvent.click(screen.getByRole('button',{name:'Review advance'}));fireEvent.click(screen.getByRole('button',{name:'Confirm advance'}));
 await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_manage_advance',expect.objectContaining({p_operation:'allocate',p_source_id:'receipt',p_order_id:'bill',p_amount:150,p_account_id:null})));
 });
 it('enforces denied server permission in the advance controls',async()=>{mock.allowed=false;render(<TransportAdvanceOperations onChanged={async()=>{}}/>);await screen.findByRole('option',{name:'Customer'});fireEvent.change(screen.getByLabelText('Advance party'),{target:{value:'customer'}});fireEvent.change(screen.getByLabelText('Advance Cash / Bank'),{target:{value:'cash'}});fireEvent.change(screen.getByLabelText('Advance amount'),{target:{value:'10'}});expect((screen.getByRole('button',{name:'Review advance'}) as HTMLButtonElement).disabled).toBe(true)});
});
