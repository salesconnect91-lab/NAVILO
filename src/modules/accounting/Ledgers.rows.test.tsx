// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {clonePrintSource} from '@/lib/printDocument';
const fixture=vi.hoisted(()=>{
 const events=Array.from({length:202},(_,i)=>({event_id:`e${String(i).padStart(3,'0')}`,kind:'opening_balance',event_type:'opening_balance',order_id:`d${i}`,order_no:`INV${i}`,side:'customer',party_id:'bari',party_name:'CASH BARI',journal_entry_id:'opening',event_date:'2026-10-12',created_at:'2026-10-12',description:'Opening',debit:5,credit:0,amount:5,original_net:10,original_gross:10,historical_settled:5}));
 return {events,ledger:[{id:'bari-ledger',party_type:'customer',party_id:'bari',party_name:'CASH BARI',journal_entry_id:'opening',entry_date:'2026-10-12',created_at:'2026-10-12',debit:1010,credit:0},{id:'other',party_type:'customer',party_id:'other',party_name:'OTHER CUSTOMER',journal_entry_id:'native',entry_date:'2026-10-12',created_at:'2026-10-12',debit:10,credit:0}]};
});
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'c'},activeBusinessUnit:{business_unit_id:'b'}})}));
vi.mock('@/components/SearchableSelect',()=>({default:({children,...props}:any)=><select {...props}>{children}</select>}));
vi.mock('@/lib/supabase',()=>({supabase:{from:(table:string)=>{const q:any={table};for(const name of ['select','order','range','eq'])q[name]=()=>q;return q;},rpc:async(name:string,args:any)=>({error:null,data:name==='transport_financial_read_allowed'?true:name==='transport_opening_invoice_query'&&args.p_kind==='details'&&args.p_side==='customer'?fixture.events.map(e=>({side:e.side,party_id:e.party_id,order_id:e.order_id,order_no:e.order_no,trip_no:`T${e.order_id}`})):[]})}}));
vi.mock('@/lib/fetchAllPages',()=>({fetchByIdChunks:vi.fn(),fetchAllPages:async(callback:any)=>{const q=callback(0,999);if(q.table)return q.table==='party_ledgers'?fixture.ledger:q.table==='customers'?[{id:'bari',name:'CASH BARI'},{id:'other',name:'OTHER CUSTOMER'}]:[];return (await q).data;}}));
vi.mock('@/modules/transport/transportOpeningInvoices',()=>({linkedPartyRows:async(_:string,side:string)=>side==='customer'?fixture.events:[]}));
import Ledgers from './Ledgers';
afterEach(()=>{cleanup();localStorage.clear();});
it('filters actual rows and totals for typed party names and prints every invoice beyond the visible page',async()=>{
 const {container}=render(<Ledgers/>);fireEvent.change(screen.getAllByRole('combobox')[0],{target:{value:'party'}});
 await waitFor(()=>expect(container.querySelector('tbody')?.textContent).toContain('INV0'));
 const input=screen.getByPlaceholderText('Type customer or supplier name...');fireEvent.change(input,{target:{value:'CASH-BARI'}});
 await waitFor(()=>expect(container.querySelector('tfoot')?.textContent).toContain('1,010.00'));
 const table=container.querySelector('table')!;expect(table.querySelectorAll('tbody tr')).toHaveLength(200);expect(table.textContent).not.toContain('OTHER CUSTOMER');
 const full=await clonePrintSource(table);expect(full.querySelectorAll('tbody tr')).toHaveLength(203);expect(full.textContent).toContain('INV201');expect(full.textContent).not.toContain('OTHER CUSTOMER');expect(full.textContent).toContain('1,010.00');
 fireEvent.click(screen.getByText('Next'));expect(table.textContent).toContain('INV201');
},30000);
