// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportPartySettlement from './TransportPartySettlement';
import type {PartyDocument,PartySide} from './transportPartyReporting';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc}}));
afterEach(()=>{cleanup();vi.clearAllMocks()});
function doc(id:string,side:PartySide,outstanding:number,date:string):PartyDocument{return {side,order_id:id,order_no:`INV-${id}`,order_date:date,party_id:'party',party_name:'Party',trip_ids:[id],trip_no:`OIC-${id}`,kind:'rent',original_net:outstanding,original_gross:outstanding,journal_entry_id:id,current_billed_gross:outstanding,current_paid_gross:0,current_refunded_gross:0,current_outstanding_gross:outstanding,current_credit_gross:0}}
describe('Cash Counter Transport allocations',()=>{
 for(const side of ['customer','supplier'] as const)it(`${side}: selected invoices, partial FIFO and reviewed canonical posting`,async()=>{
  rpc.mockImplementation(async(name:string)=>name==='transport_finance_allowed'?{data:true,error:null}:{data:{success:true,journal_entry_id:'voucher'},error:null});
  const onPosted=vi.fn(async()=>{}),busy=vi.fn();
  render(<TransportPartySettlement side={side} party="party" documents={[doc('A',side,100,'2026-10-01'),doc('B',side,200,'2026-10-02')]} accounts={[{id:'cash',name:'Cash',detail_type:'Cash on Hand'}]} onPosted={onPosted} onBusyChange={busy}/>);
  await waitFor(()=>expect((screen.getByLabelText('Select INV-B') as HTMLInputElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('Search Invoice No. / Trip No.'),{target:{value:'OIC-B'}});
  expect(screen.queryByLabelText('Select INV-A')).toBeNull();
  fireEvent.click(screen.getByLabelText('Select INV-B'));
  fireEvent.change(screen.getByLabelText('Auto allocation scope'),{target:{value:'selected'}});
  fireEvent.change(screen.getByLabelText('Amount to allocate'),{target:{value:'75'}});
  fireEvent.click(screen.getByText('Auto Allocate'));
  expect((screen.getByLabelText('Allocate INV-B') as HTMLInputElement).value).toBe('75.00');
  fireEvent.change(screen.getByLabelText('Cash / Bank'),{target:{value:'cash'}});
  fireEvent.click(screen.getByText('Review allocations'));
  expect(rpc.mock.calls.filter(([name])=>name==='transport_settle_reviewed_documents')).toHaveLength(0);
  fireEvent.click(screen.getByText('Confirm and post'));
  await waitFor(()=>expect(onPosted).toHaveBeenCalledOnce());
  const payload=rpc.mock.calls.find(([name])=>name==='transport_settle_reviewed_documents')![1];
  expect(payload).toMatchObject({p_side:side,p_party_id:'party',p_account_id:'cash',p_allocations:[{document_id:'B',amount:75}]});
  expect(payload.p_request_id).toBeTruthy();
 });
 it('blocks excess selected allocation and retains the same request on a retry',async()=>{
  let tries=0;rpc.mockImplementation(async(name:string)=>name==='transport_finance_allowed'?{data:true,error:null}:++tries===1?{data:null,error:{message:'Connection lost'}}:{data:{success:true},error:null});
  const posted=vi.fn(async()=>{});
  render(<TransportPartySettlement side="supplier" party="party" documents={[doc('A','supplier',100,'2026-10-01')]} accounts={[{id:'cash',name:'Cash',detail_type:'Cash on Hand'}]} onPosted={posted} onBusyChange={()=>{}}/>);
  await waitFor(()=>expect((screen.getByLabelText('Select INV-A') as HTMLInputElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText('Allocate INV-A'),{target:{value:'101'}});
  fireEvent.change(screen.getByLabelText('Cash / Bank'),{target:{value:'cash'}});
  expect((screen.getByText('Review allocations') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Allocate INV-A'),{target:{value:'60'}});
  fireEvent.click(screen.getByText('Review allocations'));fireEvent.click(screen.getByText('Confirm and post'));
  await screen.findByText(/Connection lost/);
  fireEvent.click(screen.getByText('Confirm and post'));
  await waitFor(()=>expect(posted).toHaveBeenCalledOnce());
  const calls=rpc.mock.calls.filter(([name])=>name==='transport_settle_reviewed_documents');expect(calls).toHaveLength(2);expect(calls[0][1]).toEqual(calls[1][1]);
 });
});
