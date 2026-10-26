// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import TransportRegisterDraftInvoices from './TransportRegisterDraftInvoices';

const mock=vi.hoisted(()=>({rpc:vi.fn(),onChanged:vi.fn(async()=>{})}));
vi.mock('./TransportDialog',()=>({default:({children}:any)=><div>{children}</div>}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc}}));

beforeEach(()=>{
 mock.rpc.mockReset();mock.onChanged.mockClear();
 mock.rpc.mockImplementation(async(name:string,args?:any)=>{
  if(name==='transport_draft_invoice_permissions')return {data:{customer:{edit:true,delete:true,post:true},supplier:{edit:true,delete:true,post:true}},error:null};
  if(name==='transport_register_draft_invoice_list')return {data:{rows:[{side:'customer',document_id:'doc-1',order_id:'sale-1',invoice_no:'S-DRAFT-1',invoice_date:'2026-10-22',party_name:'Customer One',trip_count:10,net_amount:1000,vat_amount:150}]},error:null};
  if(name==='transport_register_draft_invoice_edit_context')return {data:{side:'customer',document_id:'doc-1',order_id:'sale-1',invoice_no:'S-DRAFT-1',invoice_date:'2026-10-22',party_id:'customer-1',party_name:'Customer One',account_id:'revenue-1',line_ids:['trip-10'],trip_ids:['trip-10']},error:null};
  if(name==='transport_bulk_rate_page'){
   const initial=args?.p_filters?.initialTrip;
   const trip=initial==='trip-10'?{id:'trip-10',trip_no:'10',trip_date:'2026-10-20',customer_id:'customer-1',customer_rate:1000,customer_rate_state:'finalized',customer_rate_locked:true,from_location:'Riyadh',to_location:'Dammam'}:{id:'trip-11',trip_no:'11',trip_date:'2026-10-21',customer_id:'customer-1',customer_rate:900,customer_rate_state:'finalized',customer_rate_locked:false,from_location:'Riyadh',to_location:'Jeddah'};
   return {data:{rows:[trip],count:1},error:null};
  }
  if(name==='transport_edit_register_draft_invoice')return {data:{status:'updated',invoice_no:'S-DRAFT-1'},error:null};
  if(name==='transport_refresh_draft_invoice')return {data:{status:'refreshed'},error:null};
  if(name==='transport_post_customer_draft')return {data:{status:'posted'},error:null};
  if(name==='transport_delete_register_draft_invoice')return {data:{deleted:true},error:null};
  return {data:null,error:{message:`Unexpected RPC ${name}`}};
 });
});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});

describe('Transport Register Draft invoices',()=>{
 it('lists saved invoices and posts only after the explicit Register action',async()=>{
  render(<MemoryRouter><TransportRegisterDraftInvoices onClose={vi.fn()} onChanged={mock.onChanged}/></MemoryRouter>);
  await screen.findByText('S-DRAFT-1');
  expect(screen.getByText('Customer One')).toBeTruthy();
  expect(screen.getByText('10')).toBeTruthy();
  expect(mock.rpc).toHaveBeenCalledWith('transport_register_draft_invoice_list');
  fireEvent.click(screen.getByRole('button',{name:'Refresh from Trips'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_refresh_draft_invoice',{p_side:'customer',p_document_id:'doc-1'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Post Invoice'})).toBeTruthy());
  fireEvent.click(screen.getByRole('button',{name:'Post Invoice'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_post_customer_draft',{p_document_id:'doc-1'}));
  await waitFor(()=>expect(mock.onChanged).toHaveBeenCalled());
 });
 it('deletes only the Draft invoice wrapper and keeps its Trips',async()=>{
  vi.stubGlobal('confirm',vi.fn(()=>true));
  render(<MemoryRouter><TransportRegisterDraftInvoices onClose={vi.fn()} onChanged={mock.onChanged}/></MemoryRouter>);
  await screen.findByText('S-DRAFT-1');
  fireEvent.click(screen.getByRole('button',{name:'Delete Draft'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_delete_register_draft_invoice',{p_side:'customer',p_document_id:'doc-1'}));
  expect(await screen.findByText(/Draft deleted\. The Trips remain in Register/)).toBeTruthy();
 });
 it('edits a draft in place while preserving its document and invoice number',async()=>{
  render(<MemoryRouter><TransportRegisterDraftInvoices onClose={vi.fn()} onChanged={mock.onChanged}/></MemoryRouter>);
  await screen.findByText('S-DRAFT-1');fireEvent.click(screen.getByRole('button',{name:'Edit Draft'}));
  const include=await screen.findByRole('checkbox',{name:'Include Trip 11'});fireEvent.click(include);
  expect((screen.getByRole('checkbox',{name:'Include Trip 10'}) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Save Draft Changes'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_edit_register_draft_invoice',{
   p_side:'customer',p_document_id:'doc-1',p_line_ids:['trip-10','trip-11'],p_invoice_date:'2026-10-22',p_invoice_no:'S-DRAFT-1',p_account_id:'revenue-1'
  }));
  expect(await screen.findByText(/draft updated in place/)).toBeTruthy();expect(mock.onChanged).toHaveBeenCalled();
 });
});
