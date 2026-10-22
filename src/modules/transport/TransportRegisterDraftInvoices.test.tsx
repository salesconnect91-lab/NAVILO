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
 mock.rpc.mockImplementation(async(name:string)=>{
  if(name==='transport_register_draft_invoice_list')return {data:{rows:[{side:'customer',document_id:'doc-1',order_id:'sale-1',invoice_no:'S-DRAFT-1',invoice_date:'2026-10-22',party_name:'Customer One',trip_count:10,net_amount:1000,vat_amount:150}]},error:null};
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
});
