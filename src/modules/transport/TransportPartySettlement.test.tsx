// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import TransportPartySettlement from './TransportPartySettlement';
import type {PartyDocument,PartySide} from './transportPartyReporting';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc}}));
afterEach(()=>{cleanup();vi.clearAllMocks()});
function doc(id:string,side:PartySide,outstanding:number,date:string):PartyDocument{return {side,order_id:id,order_no:`INV-${id}`,order_date:date,party_id:'party',party_name:'Party',trip_ids:[id],trip_no:`OIC-${id}`,kind:'rent',original_net:outstanding,original_gross:outstanding,journal_entry_id:id,current_billed_gross:outstanding,current_paid_gross:0,current_refunded_gross:0,current_outstanding_gross:outstanding,current_credit_gross:0}}
describe('Cash Counter Transport allocations',()=>{
 for(const side of ['customer','supplier'] as const)it(`${side}: imported opening invoice from parent's scoped snapshot posts through opening engine`,async()=>{
  const opening={...doc('OPEN',side,100,'2026-10-12'),kind:'opening_balance',historical_settled:50};
  rpc.mockImplementation(async(name:string)=>name==='transport_finance_allowed'?{data:true,error:null}:name==='transport_party_report_query'?{data:[],error:null}:name==='transport_opening_invoice_query'?{data:[opening],error:null}:{data:{success:true,journal_entry_id:'opening-voucher'},error:null});
  const posted=vi.fn(async()=>{});
  render(<TransportPartySettlement side={side} party="party" documents={[opening]} accounts={[{id:'cash',name:'Cash',detail_type:'Cash on Hand'}]} onPosted={posted} onBusyChange={()=>{}}/>);
  await screen.findByLabelText('Allocate INV-OPEN');
  fireEvent.change(screen.getByLabelText('Allocate INV-OPEN'),{target:{value:'30'}});fireEvent.change(screen.getByLabelText('Cash / Bank'),{target:{value:'cash'}});
  fireEvent.click(screen.getByText('Review allocations'));expect(rpc.mock.calls.some(([name])=>name==='transport_settle_opening_invoices')).toBe(false);
  fireEvent.click(screen.getByText('Confirm and post'));await waitFor(()=>expect(posted).toHaveBeenCalledOnce());
  expect(rpc).toHaveBeenCalledWith('transport_settle_opening_invoices',expect.objectContaining({p_side:side,p_party_id:'party',p_allocations:[{document_id:'OPEN',amount:30}]}));
  expect(rpc.mock.calls.some(([name])=>name==='transport_settle_reviewed_documents')).toBe(false);
  // The parent has already fetched both sources. This child must not refetch
  // either RPC while preparing, reviewing, or posting a payment.
  expect(rpc.mock.calls.some(([name])=>name==='transport_opening_invoice_query'||name==='transport_party_report_query')).toBe(false);
 });
 for(const side of ['customer','supplier'] as const)it(`${side}: selected invoices, partial FIFO and reviewed canonical posting`,async()=>{
  const docs=[doc('A',side,100,'2026-10-01'),doc('B',side,200,'2026-10-02')];
  rpc.mockImplementation(async(name:string)=>name==='transport_party_report_query'?{data:docs,error:null}:name==='transport_opening_invoice_query'?{data:[],error:null}:name==='transport_finance_allowed'?{data:true,error:null}:{data:{success:true,journal_entry_id:'voucher'},error:null});
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
 it('uses fresh parent invoices without a second identical RPC query',async()=>{
  const oldDocs=[doc('A','supplier',100,'2026-10-01')];
  rpc.mockImplementation(async(name:string)=>name==='transport_finance_allowed'?{data:true,error:null}:{data:{success:true},error:null});
  const renderResult=render(<TransportPartySettlement side="supplier" party="party" documents={oldDocs} accounts={[]} onPosted={async()=>{}} onBusyChange={()=>{}}/>);
  expect(await screen.findByLabelText('Allocate INV-A')).toBeTruthy();
  const refreshed=[doc('B','supplier',50,'2026-10-02')];
  renderResult.rerender(<TransportPartySettlement side="supplier" party="party" documents={refreshed} accounts={[]} onPosted={async()=>{}} onBusyChange={()=>{}}/>);
  expect(await screen.findByLabelText('Allocate INV-B')).toBeTruthy();
  expect(screen.queryByLabelText('Allocate INV-A')).toBeNull();
  expect(rpc.mock.calls.filter(([name])=>name==='transport_party_report_query'||name==='transport_opening_invoice_query')).toHaveLength(0);
 });
 it('searches and selects a Cash / Bank option without posting',async()=>{
  const docs=[doc('A','supplier',100,'2026-10-01')];
  rpc.mockImplementation(async(name:string)=>name==='transport_party_report_query'?{data:docs,error:null}:name==='transport_opening_invoice_query'?{data:[],error:null}:name==='transport_finance_allowed'?{data:true,error:null}:{data:{success:true},error:null});
  render(<TransportPartySettlement side="supplier" party="party" documents={docs} accounts={[{id:'cash',name:'Cash Account',detail_type:'Cash on Hand'},{id:'bank',name:'Bank Account',detail_type:'Bank Account'}]} onPosted={async()=>{}} onBusyChange={()=>{}}/>);
  await screen.findByLabelText('Allocate INV-A');
  const native=screen.getByLabelText('Cash / Bank') as HTMLSelectElement;
  const trigger=native.parentElement?.querySelector('[aria-haspopup="listbox"]');
  expect(trigger).toBeTruthy();fireEvent.click(trigger!);
  fireEvent.change(screen.getByPlaceholderText('Type to search...'),{target:{value:'Bank Account'}});
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option',{name:'Bank Account'}));
  expect(native.value).toBe('bank');
  expect(rpc.mock.calls.some(([name])=>name.startsWith('transport_settle_'))).toBe(false);
 });
 it('views a supplier bill and its source without posting or changing the draft',async()=>{
  const docs=[doc('A','supplier',100,'2026-10-01')];
  rpc.mockImplementation(async(name:string)=>name==='transport_party_report_query'?{data:docs,error:null}:name==='transport_opening_invoice_query'?{data:[],error:null}:name==='transport_finance_allowed'?{data:true,error:null}:{data:{success:true},error:null});
  render(<TransportPartySettlement side="supplier" party="party" documents={docs} accounts={[]} onPosted={async()=>{}} onBusyChange={()=>{}}/>);
  await screen.findByLabelText('View INV-A');fireEvent.click(screen.getByLabelText('View INV-A'));
  const details=screen.getByRole('dialog',{name:'Allocation invoice details'});
  expect(details.parentElement?.classList.contains('navilo-transport-dialog')).toBe(true);
  expect((screen.getByRole('link',{name:/Open supplier invoice/}) as HTMLAnchorElement).getAttribute('href')).toBe('/purchase/A');
  expect((screen.getByRole('link',{name:/Open journal voucher/}) as HTMLAnchorElement).getAttribute('href')).toBe('/accounting/A');
  expect(rpc.mock.calls.some(([name])=>name.startsWith('transport_settle_'))).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Close'}));
  expect(screen.queryByRole('dialog',{name:'Allocation invoice details'})).toBeNull();
 });
 it('blocks excess selected allocation and retains the same request on a retry',async()=>{
  let tries=0;rpc.mockImplementation(async(name:string)=>name==='transport_party_report_query'?{data:[doc('A','supplier',100,'2026-10-01')],error:null}:name==='transport_opening_invoice_query'?{data:[],error:null}:name==='transport_finance_allowed'?{data:true,error:null}:++tries===1?{data:null,error:{message:'Connection lost'}}:{data:{success:true},error:null});
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
