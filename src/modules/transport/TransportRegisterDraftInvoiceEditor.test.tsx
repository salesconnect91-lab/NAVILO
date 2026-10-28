// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';

const mock = vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc}}));
vi.mock('./TransportDialog',()=>({default:({children}:any)=>children}));
vi.mock('./TransportReasonSelect',()=>({default:()=>null}));

import TransportRegisterDraftInvoiceEditor from './TransportRegisterDraftInvoiceEditor';

const row={side:'customer' as const,document_id:'doc-1',order_id:'order-1',invoice_no:'INV-001',invoice_date:'2026-10-20',party_name:'Customer A',trip_count:1};
const supplierRow={...row,side:'supplier' as const,invoice_no:'SUP-001',party_name:'Supplier A'};
const trip=(n:number)=>({id:`trip-${n}`,trip_no:`TRP-${String(n).padStart(4,'0')}`,trip_date:'2026-10-20',from_location:'Dammam',to_location:'Riyadh',vehicle_no:`T-${n}`,driver_name:'Driver',po_do_job_no:'',customer_id:'customer-1',customer_rate:100,customer_rate_state:'finalized',customer_rate_locked:false});
const supplierTrip=(n:number)=>({...trip(n),party_id:'supplier-1',posted:false,draftLinked:false,legacyBlocked:false,rent:{state:'finalized',finalized_amount_snapshot:80}});
let allTrips:ReturnType<typeof trip>[];
let allSupplierTrips:ReturnType<typeof supplierTrip>[];

beforeEach(()=>{
 allTrips=Array.from({length:501},(_,i)=>trip(i+1));
 allSupplierTrips=Array.from({length:501},(_,i)=>supplierTrip(i+1));
 mock.rpc.mockReset();
 mock.rpc.mockImplementation(async(name:string,args:any)=>{
  if(name==='transport_register_draft_invoice_edit_context')return {data:{side:args.p_side,document_id:'doc-1',order_id:'order-1',invoice_no:args.p_side==='supplier'?'SUP-001':'INV-001',invoice_date:'2026-10-20',party_id:args.p_side==='supplier'?'supplier-1':'customer-1',party_name:args.p_side==='supplier'?'Supplier A':'Customer A',account_id:args.p_side==='supplier'?'expense-1':'revenue-1',line_ids:['trip-1'],trip_ids:[]},error:null};
  if(name==='transport_bulk_rate_page'){
   const f=args.p_filters||{};
   const source: Array<Record<string,any>>=args.p_side==='supplier'?allSupplierTrips:allTrips;
   const searched=source.filter(t=>(args.p_side==='supplier'?t.party_id===f.party:t.customer_id===f.party)&&(!f.search||`${t.trip_no} ${t.from_location} ${t.to_location} ${t.vehicle_no} ${t.driver_name}`.toLowerCase().includes(String(f.search).toLowerCase())));
   return {data:{rows:searched.slice(args.p_offset,args.p_offset+args.p_limit)},error:null};
  }
  if(name==='transport_edit_register_draft_invoice')return {data:{invoice_no:args.p_invoice_no},error:null};
  return {data:null,error:null};
 });
});
afterEach(()=>cleanup());

describe('Transport draft invoice editor pagination and selection',()=>{
 it('loads beyond the first 500 eligible Trips',async()=>{
  render(<TransportRegisterDraftInvoiceEditor row={row} onClose={vi.fn()} onSaved={async()=>{}}/>);
  await screen.findByText('TRP-0001');
  expect(screen.queryByText('TRP-0501')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Load more Trips'}));
  await screen.findByText('TRP-0501');
  expect(mock.rpc).toHaveBeenCalledWith('transport_bulk_rate_page',expect.objectContaining({p_limit:500,p_offset:500}));
 });

 it('finds a Trip beyond the first page using server-side search',async()=>{
  render(<TransportRegisterDraftInvoiceEditor row={row} onClose={vi.fn()} onSaved={async()=>{}}/>);
  await screen.findByText('TRP-0001');
  fireEvent.change(screen.getByLabelText('Search editable draft trips'),{target:{value:'TRP-0501'}});
  await screen.findByText('TRP-0501');
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_bulk_rate_page',expect.objectContaining({p_offset:0,p_filters:expect.objectContaining({search:'TRP-0501'})})));
 });

 it('loads supplier Trips beyond the first 500 as well',async()=>{
  render(<TransportRegisterDraftInvoiceEditor row={supplierRow} onClose={vi.fn()} onSaved={async()=>{}}/>);
  await screen.findByText('TRP-0001');
  expect(screen.queryByText('TRP-0501')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Load more Trips'}));
  await screen.findByText('TRP-0501');
  expect(mock.rpc).toHaveBeenCalledWith('transport_bulk_rate_page',expect.objectContaining({p_side:'supplier',p_limit:500,p_offset:500}));
 });

 it('keeps the selected Trip when searching for another Trip',async()=>{
  render(<TransportRegisterDraftInvoiceEditor row={row} onClose={vi.fn()} onSaved={async()=>{}}/>);
  await screen.findByText('TRP-0001');
  expect((screen.getByLabelText('Include Trip TRP-0001') as HTMLInputElement).checked).toBe(true);
  fireEvent.change(screen.getByLabelText('Search editable draft trips'),{target:{value:'TRP-0501'}});
  await screen.findByText('TRP-0501');
  expect(screen.getByText(/1 Trip line\(s\) selected/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Save Draft Changes'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_edit_register_draft_invoice',expect.objectContaining({p_line_ids:['trip-1']})));
 });
});
