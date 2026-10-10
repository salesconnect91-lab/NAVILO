// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportFinancialPanel from './TransportFinancialPanel';
const mock=vi.hoisted(()=>({allowed:false,cash:false,failCash:false,supplier:false,failSettlement:false,rpc:vi.fn()}));
const trip={id:'trip-a',trip_no:'TRP-A',customer_id:'customer-a',customer_rate:100,billed_customer_net:100,financial_status:'Under Settlement',customer_rate_locked:true};
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'company'},activeBusinessUnit:{business_unit_id:'unit'}})}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc,from:(table:string)=>{
 const data:Record<string,unknown>={transport_financial_register:mock.cash?{...trip,customer_rate_locked:false,customer_rate_state:'finalized',sale_type:'cash'}:trip,transport_customer_document_trips:[{document_id:'link-a'}],transport_customer_documents:[{sales_order_id:'invoice-a'}],chart_of_accounts:[{id:'cash-a',name:'Cash',type:'asset',detail_type:'Cash on Hand'}],transport_service_document_balances:[{side:'customer',order_id:'invoice-a',order_no:'S-A',party_id:'customer-a',billed_gross:118,paid_gross:59,refunded_gross:0,outstanding_gross:59,credit_gross:0}]};
 if(mock.cash){data.transport_customer_document_trips=[];data.transport_service_document_balances=[];}
 if(mock.supplier){data.transport_trip_supplier_rents=[{id:'rent-a',supplier_id:'supplier-a',amount:70}];data.suppliers=[{id:'supplier-a',name:'Supplier A'}];}
 if(mock.failSettlement){data.invoice_payment_allocations=[{journal_entry_id:'receipt'}];data.journal_entries=[{id:'receipt',entry_no:'R-1',entry_date:'2026-10-01',trans_type:'Customer Receipt',payment_amount:59,payment_mode:'cash',journal_lines:[{account_id:'cash-a',debit:59,credit:0}]}];}
 const q:any={};for(const method of ['select','eq','single','in','order','range'])q[method]=()=>q;q.then=(resolve:any)=>Promise.resolve({data:data[table]??[],error:null}).then(resolve);return q;
}}}));
beforeEach(()=>{mock.allowed=false;mock.cash=false;mock.failCash=false;mock.supplier=false;mock.failSettlement=false;mock.rpc.mockReset();mock.rpc.mockImplementation(async(name:string)=>({data:name==='transport_finance_allowed'?mock.allowed:{success:true},error:(name==='transport_post_cash_bill_receive'&&mock.failCash)||(name==='transport_correct_settlement'&&mock.failSettlement)?{message:'Network interrupted'}:null}))});afterEach(cleanup);
describe('Transport canonical finance controls',()=>{
 it('does not expose or request driver bookkeeping actions',async()=>{mock.allowed=true;render(<TransportFinancialPanel trip={trip} onClose={vi.fn()} onChanged={async()=>{}}/>);await screen.findByRole('button',{name:'Credit / Debit Note'});expect(screen.queryByRole('button',{name:'Driver Pay'})).toBeNull();expect(screen.queryByText('Driver Account / Hisaab')).toBeNull();expect(mock.rpc.mock.calls.some(c=>c[0]==='transport_finance_allowed'&&c[1]?.p_action==='driver')).toBe(false)});
 it('posts a Cash Only customer invoice without inventing a full cash receipt',async()=>{
 mock.allowed=true;mock.cash=true;
 render(<TransportFinancialPanel trip={{...trip,customer_rate_locked:false,customer_rate_state:'finalized',sale_type:'cash'}} onClose={vi.fn()} onChanged={async()=>{}}/>);
 await screen.findByRole('button',{name:'Post Customer Bill'});
 expect(screen.getByText(/Cash Only invoice is posted without a receipt/)).toBeTruthy();
 expect((screen.getByRole('button',{name:'Post Customer Bill'}) as HTMLButtonElement).disabled).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Post Customer Bill'}));
 await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_post_customer_bill',{p_trip_id:'trip-a',p_date:expect.any(String),p_with_tax:false}));
 expect(mock.rpc.mock.calls.some(([name])=>name==='transport_post_customer_bill_settled'||name==='transport_post_cash_bill_receive')).toBe(false);
 });

 it('keeps financial actions disabled without server permissions and original billing protected',async()=>{
 render(<TransportFinancialPanel trip={trip} onClose={vi.fn()} onChanged={async()=>{}}/>);
 await screen.findByText('S-A');
 expect(screen.queryByRole('button',{name:'Post Customer Bill'})).toBeNull();
 const noteButton=screen.getByRole('button',{name:'Credit / Debit Note'}) as HTMLButtonElement;
 expect(noteButton.disabled).toBe(true);
 expect(screen.queryByRole('button',{name:'Save Note'})).toBeNull();
 });
 it('posts selected VAT-inclusive amount only against the selected canonical invoice',async()=>{
 mock.allowed=true;render(<TransportFinancialPanel trip={trip} onClose={vi.fn()} onChanged={async()=>{}}/>);await screen.findByText('S-A');
 fireEvent.change(screen.getByLabelText('Cash / Bank'),{target:{value:'cash-a'}});
 fireEvent.change(screen.getByLabelText('Allocation S-A'),{target:{value:'59'}});
 fireEvent.click(screen.getByRole('button',{name:'Post Selected Allocations'}));
 await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_settle_reviewed_documents',expect.objectContaining({p_side:'customer',p_party_id:'customer-a',p_allocations:[{document_id:'invoice-a',amount:59}]})));
 expect(screen.queryByRole('button',{name:'Post Customer Bill'})).toBeNull();
 });
 it('saves unposted Supplier rent through finalization instead of posted adjustment',async()=>{
  mock.allowed=true;mock.supplier=true;
  render(<TransportFinancialPanel trip={trip} onClose={vi.fn()} onChanged={async()=>{}}/>);
  await screen.findByText('S-A');fireEvent.click(screen.getByRole('button',{name:'Supplier'}));
  await waitFor(()=>expect(screen.getAllByText('Supplier A').length).toBeGreaterThan(0));
  expect(screen.queryByRole('button',{name:'Credit / Debit Note'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Customer'}));
  fireEvent.click(screen.getByRole('button',{name:'Credit / Debit Note'}));
  fireEvent.change(screen.getByLabelText('Rate side'),{target:{value:'supplier'}});
  fireEvent.change(screen.getByLabelText('Supplier rent'),{target:{value:'rent-a'}});
  fireEvent.change(screen.getByLabelText('New rate excluding VAT'),{target:{value:'75'}});
  fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Agreed rent'}});
  fireEvent.click(screen.getByRole('button',{name:'Save Rent Change'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_finalize_supplier_rent',{p_rent_id:'rent-a',p_amount:75,p_reason:'Agreed rent'}));
  expect(mock.rpc.mock.calls.some(([name])=>name==='transport_adjust_rate')).toBe(false);
 });
 it('retains a failed settlement correction instead of closing its form',async()=>{
  mock.allowed=true;mock.failSettlement=true;
  render(<TransportFinancialPanel trip={trip} onClose={vi.fn()} onChanged={async()=>{}}/>);
  await screen.findByRole('button',{name:'Correct Receipt'});fireEvent.click(screen.getByRole('button',{name:'Correct Receipt'}));
  fireEvent.change(screen.getByLabelText('Correct amount'),{target:{value:'50'}});
  fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Amount correction'}});
  fireEvent.click(screen.getByRole('button',{name:'Post Correction'}));
  await screen.findByText('Network interrupted');expect(screen.getByLabelText('Correct amount')).toBeTruthy();
 });

});
