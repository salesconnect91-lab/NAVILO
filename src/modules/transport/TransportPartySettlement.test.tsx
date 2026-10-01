// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportPartySettlement from './TransportPartySettlement';
import type {PartyDocument} from './transportPartyReporting';
const mock=vi.hoisted(()=>({rpc:vi.fn(),allowed:true,fail:false}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc}}));
const doc=(id:string):PartyDocument=>({side:'supplier',order_id:id,party_id:'s',party_name:'Supplier',order_no:id,order_date:'2026-09-01',trip_ids:[id],trip_no:`Trip-${id}`,kind:'rent',original_net:100,original_gross:118,journal_entry_id:id,current_billed_gross:118,current_paid_gross:0,current_refunded_gross:0,current_outstanding_gross:118,current_credit_gross:0});
function setup(){return render(<TransportPartySettlement side="supplier" party="s" documents={[doc('A'),doc('B')]} accounts={[{id:'cash',name:'Cash',detail_type:'Cash on Hand'}]} onPosted={async()=>{}} onBusyChange={()=>{}}/>)}
beforeEach(()=>{mock.allowed=true;mock.fail=false;mock.rpc.mockReset();mock.rpc.mockImplementation(async(name:string)=>name==='transport_finance_allowed'?{data:mock.allowed,error:null}:mock.fail?{data:null,error:{message:'Network'}}:{data:{payments:[{journal_entry_id:'journal'}]},error:null})});afterEach(cleanup);
describe('Reviewed cross-Trip supplier payments',()=>{
 it('requires review and posts exact partial allocations without triggering FIFO server-side',async()=>{
 setup();await waitFor(()=>expect((screen.getByLabelText('Allocate A') as HTMLInputElement).disabled).toBe(false));
 fireEvent.change(screen.getByLabelText('Cash / Bank'),{target:{value:'cash'}});fireEvent.change(screen.getByLabelText('Allocate A'),{target:{value:'30'}});fireEvent.change(screen.getByLabelText('Allocate B'),{target:{value:'20'}});
 expect(screen.queryByRole('button',{name:'Confirm and post'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Review allocations'}));fireEvent.click(screen.getByRole('button',{name:'Confirm and post'}));
 await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_settle_reviewed_documents',expect.objectContaining({p_side:'supplier',p_party_id:'s',p_allocations:[{document_id:'A',amount:30},{document_id:'B',amount:20}]})));
 expect(await screen.findByRole('status')).toHaveProperty('textContent',expect.stringContaining('50.00'));
 });
 it('prepares FIFO without posting and denies payments when server permission is false',async()=>{
 setup();await waitFor(()=>expect((screen.getByLabelText('Allocate A') as HTMLInputElement).disabled).toBe(false));fireEvent.change(screen.getByLabelText('FIFO amount'),{target:{value:'150'}});fireEvent.click(screen.getByRole('button',{name:'Prepare FIFO'}));
 expect((screen.getByLabelText('Allocate A') as HTMLInputElement).value).toBe('118.00');expect((screen.getByLabelText('Allocate B') as HTMLInputElement).value).toBe('32.00');expect(mock.rpc.mock.calls.filter(c=>c[0]!=='transport_finance_allowed')).toHaveLength(0);
 cleanup();mock.allowed=false;setup();await waitFor(()=>expect((screen.getByRole('button',{name:'Prepare FIFO'}) as HTMLButtonElement).disabled).toBe(true));
 });
 it('retries an unchanged reviewed request with the same idempotency key',async()=>{
 mock.fail=true;setup();await waitFor(()=>expect((screen.getByLabelText('Allocate A') as HTMLInputElement).disabled).toBe(false));fireEvent.change(screen.getByLabelText('Cash / Bank'),{target:{value:'cash'}});fireEvent.change(screen.getByLabelText('Allocate A'),{target:{value:'30'}});fireEvent.click(screen.getByRole('button',{name:'Review allocations'}));fireEvent.click(screen.getByRole('button',{name:'Confirm and post'}));await screen.findByRole('alert');
 const first=mock.rpc.mock.calls.find(c=>c[0]==='transport_settle_reviewed_documents')![1].p_request_id;mock.fail=false;fireEvent.click(screen.getByRole('button',{name:'Confirm and post'}));await screen.findByRole('status');
 const calls=mock.rpc.mock.calls.filter(c=>c[0]==='transport_settle_reviewed_documents');expect(calls).toHaveLength(2);expect(calls[1][1].p_request_id).toBe(first);
 });
});
