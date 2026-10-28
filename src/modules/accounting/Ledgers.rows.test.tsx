// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {clonePrintSource} from '@/lib/printDocument';
const fixture=vi.hoisted(()=>{
 const events=Array.from({length:202},(_,i)=>({event_id:`e${String(i).padStart(3,'0')}`,kind:'opening_balance',event_type:'opening_balance',order_id:`d${i}`,order_no:`INV${i}`,side:'customer',party_id:'bari',party_name:'CASH BARI',journal_entry_id:'opening',event_date:'2026-10-12',created_at:'2026-10-12',description:'Opening',debit:5,credit:0,amount:5,original_net:10,original_gross:10,historical_settled:5}));
 return {events,ledger:[{id:'bari-ledger',party_type:'customer',party_id:'bari',party_name:'CASH BARI',journal_entry_id:'opening',entry_date:'2026-10-12',created_at:'2026-10-12',debit:1010,credit:0},{id:'other',party_type:'customer',party_id:'other',party_name:'OTHER CUSTOMER',journal_entry_id:'native',entry_date:'2026-10-12',created_at:'2026-10-12',debit:10,credit:0}]};
});
const api=vi.hoisted(()=>({reads:vi.fn(),rpc:vi.fn()}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'c'},activeBusinessUnit:{business_unit_id:'b'}})}));
vi.mock('@/components/SearchableSelect',()=>({default:({children,...props}:any)=><select {...props}>{children}</select>}));
vi.mock('@/lib/supabase',()=>({
 supabase:{
  from:(table:string)=>{
   const q:any={table,filters:[]};api.reads(table);
   for(const name of ['select','order','range'])q[name]=()=>q;
   q.eq=(field:string,value:unknown)=>{q.filters.push([field,value]);return q};
   return q;
  },
  rpc:async(name:string,args:any)=>{
   api.rpc(name,args);
   const data=name==='transport_financial_read_allowed'?true:
    name==='transport_opening_invoice_query'&&args.p_kind==='details'&&args.p_side==='customer'
     ?fixture.events.map(e=>({side:e.side,party_id:e.party_id,order_id:e.order_id,order_no:e.order_no,trip_no:`T${e.order_id}`})):[];
   return {error:null,data};
  },
 }
}));
vi.mock('@/lib/fetchAllPages',()=>({fetchByIdChunks:vi.fn(),fetchAllPages:async(callback:any)=>{const q=callback(0,999);if(q.table){if(q.table==='party_ledgers')return fixture.ledger.filter(r=>q.filters.every(([k,v]:[string,unknown])=>(r as any)[k]===v));if(q.table==='customers')return [{id:'bari',name:'CASH BARI'},{id:'other',name:'OTHER CUSTOMER'}];return [];}return (await q).data;}}));
vi.mock('@/modules/transport/transportOpeningInvoices',()=>({linkedPartyRows:async(_:string,side:string)=>side==='customer'?fixture.events:[]}));
import Ledgers from './Ledgers';
afterEach(()=>{cleanup();localStorage.clear();vi.clearAllMocks()});
it('shows a compact ledger-style Party Statement and avoids expensive unfiltered reads',async()=>{
 const {container}=render(<MemoryRouter><Ledgers/></MemoryRouter>);
 fireEvent.change(screen.getAllByRole('combobox')[0],{target:{value:'party'}});
 await screen.findByText(/Select a party to view its ledger/);
 expect(api.reads.mock.calls.some(([table])=>table==='party_ledgers')).toBe(false);
 expect(api.rpc.mock.calls.some(([name])=>name==='transport_document_trip_detail_query')).toBe(false);
 expect(Array.from(container.querySelectorAll('thead th')).map(th=>th.textContent?.trim())).toEqual(['Date','Party','Reference','Description','Debit','Credit','Balance']);
 const input=screen.getByPlaceholderText('Type customer or supplier name...');
 fireEvent.change(input,{target:{value:'CASH-BARI'}});
 fireEvent.click(screen.getByRole('button',{name:/CASH BARI/i}));
 await waitFor(()=>expect(container.querySelector('tfoot')?.textContent).toContain('1,010.00'));
 expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
 expect(api.rpc.mock.calls.some(([name])=>name==='transport_document_trip_detail_query')).toBe(false);
},30000);
it('loads selected-party invoice evidence only on demand and prints all rows',async()=>{
 const {container}=render(<MemoryRouter><Ledgers/></MemoryRouter>);
 fireEvent.change(screen.getAllByRole('combobox')[0],{target:{value:'party'}});
 const input=screen.getByPlaceholderText('Type customer or supplier name...');
 fireEvent.change(input,{target:{value:'CASH BARI'}});
 fireEvent.click(await screen.findByRole('button',{name:/CASH BARI/i}));
 await waitFor(()=>expect(container.querySelectorAll('tbody tr')).toHaveLength(1));
 fireEvent.click(screen.getByRole('button',{name:'Show Trip / Invoice Details'}));
 await waitFor(()=>expect(container.querySelectorAll('tbody tr')).toHaveLength(200));
 const table=container.querySelector('table')!;
 const full=await clonePrintSource(table);
 expect(full.querySelectorAll('tbody tr')).toHaveLength(203);
 expect(full.textContent).toContain('INV201');
 expect(full.textContent).not.toContain('OTHER CUSTOMER');
 expect(full.textContent).toContain('1,010.00');
 fireEvent.click(screen.getByText('Next'));
 expect(table.textContent).toContain('INV201');
},30000);
