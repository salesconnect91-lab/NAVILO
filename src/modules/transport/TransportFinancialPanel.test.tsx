// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportFinancialPanel from './TransportFinancialPanel';
const mock=vi.hoisted(()=>({allowed:false,rpc:vi.fn()}));
const trip={id:'trip-a',trip_no:'TRP-A',customer_id:'customer-a',customer_rate:100,billed_customer_net:100,financial_status:'Under Settlement',customer_rate_locked:true};
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'company'},activeBusinessUnit:{business_unit_id:'unit'}})}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc,from:(table:string)=>{
 const data:Record<string,unknown>={transport_financial_register:trip,transport_customer_document_trips:[{document_id:'link-a'}],transport_customer_documents:[{sales_order_id:'invoice-a'}],chart_of_accounts:[{id:'cash-a',name:'Cash',type:'asset',detail_type:'Cash on Hand'}],transport_service_document_balances:[{side:'customer',order_id:'invoice-a',order_no:'S-A',party_id:'customer-a',billed_gross:118,paid_gross:59,refunded_gross:0,outstanding_gross:59,credit_gross:0}]};
 const q:any={};for(const method of ['select','eq','single','in','order','range'])q[method]=()=>q;q.then=(resolve:any)=>Promise.resolve({data:data[table]??[],error:null}).then(resolve);return q;
}}}));
beforeEach(()=>{mock.allowed=false;mock.rpc.mockReset();mock.rpc.mockImplementation(async(name:string)=>({data:name==='transport_finance_allowed'?mock.allowed:{success:true},error:null}))});afterEach(cleanup);
describe('Transport canonical finance controls',()=>{
 it('keeps financial actions disabled without server permissions and original billing protected',async()=>{
 render(<TransportFinancialPanel trip={trip} onClose={vi.fn()} onChanged={async()=>{}}/>);
 await screen.findByText('S-A');
 expect(screen.queryByRole('button',{name:'Post Customer Bill'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Correct Rate'}));
 expect((screen.getByRole('button',{name:'Post Rate Adjustment'}) as HTMLButtonElement).disabled).toBe(true);
 expect(screen.getByText(/Original posted rate: 100.00/)).toBeTruthy();
 });
 it('posts selected VAT-inclusive amount only against the selected canonical invoice',async()=>{
 mock.allowed=true;render(<TransportFinancialPanel trip={trip} onClose={vi.fn()} onChanged={async()=>{}}/>);await screen.findByText('S-A');
 fireEvent.change(screen.getByLabelText('Cash / Bank'),{target:{value:'cash-a'}});
 fireEvent.change(screen.getByLabelText('Allocation S-A'),{target:{value:'59'}});
 fireEvent.click(screen.getByRole('button',{name:'Post Selected Allocations'}));
 await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_settle_reviewed_documents',expect.objectContaining({p_side:'customer',p_party_id:'customer-a',p_allocations:[{document_id:'invoice-a',amount:59}]})));
 expect(screen.queryByRole('button',{name:'Post Customer Bill'})).toBeNull();
 });
});
