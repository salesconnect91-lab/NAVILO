// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportPartyReports from './TransportPartyReports';
const mock=vi.hoisted(()=>({export:vi.fn(),ledger:true,fail:false}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'c',company_name:'Company'},activeBusinessUnit:{business_unit_id:'b',business_unit_name:'Transport'}})}));
vi.mock('./transportPartyExport',()=>({exportPartyReport:mock.export}));
vi.mock('@/lib/supabase',()=>{const from=(table:string)=>{
 const doc={side:'customer',order_id:'A',party_id:'customer',party_name:'Customer A',order_no:'INV-A',order_date:'2026-09-01',trip_ids:['trip'],trip_no:'Trip-1',kind:'credit',original_net:100,original_gross:118,journal_entry_id:'j',current_outstanding_gross:59,current_credit_gross:0};
 const bill={event_id:'b',side:'customer',party_id:'customer',party_name:'Customer A',order_id:'A',order_no:'INV-A',trip_no:'Trip-1',journal_entry_id:'j',entry_no:'J-1',event_date:'2026-09-01',created_at:'2026-09-01',event_type:'bill',debit:118,credit:0,amount:118,net_amount:100};
 const receipt={...bill,event_id:'p',event_date:'2026-09-02',created_at:'2026-09-02',event_type:'receipt',debit:0,credit:59,amount:-59,net_amount:-50};
 const rows:Record<string,unknown[]>={transport_party_documents:[doc],transport_party_movements:[bill,receipt],transport_canonical_party_movements:[bill,receipt],chart_of_accounts:[]};
 const q:any={};for(const m of ['select','eq','in','order','range'])q[m]=()=>q;q.then=(resolve:any)=>Promise.resolve({data:rows[table]??[],error:mock.fail?{message:'API unavailable'}:null}).then(resolve);return q;
};return {supabase:{from,rpc:async(name:string,args?:{p_kind:string})=>name==='transport_document_trip_details'?{data:[],error:null}:name==='transport_party_report_page'?await from('transport_'+(args?.p_kind==='canonical'?'canonical_party_movements':args?.p_kind==='documents'?'party_documents':'party_movements')):{data:mock.ledger,error:null}}};});
beforeEach(()=>{mock.export.mockReset();mock.ledger=true;mock.fail=false});afterEach(cleanup);
function setup(){render(<TransportPartyReports onClose={()=>{}} onChanged={async()=>{}}/>)}
describe('Separate Transport party reporting',()=>{
 it('exports the complete filtered VAT-inclusive outstanding with totals',async()=>{
 setup();await screen.findByText('TOTAL');await waitFor(()=>expect((screen.getByRole('button',{name:'Excel'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Excel'}));await waitFor(()=>expect(mock.export).toHaveBeenCalled());
 const table=mock.export.mock.calls[0][0];expect(table.rows[0].slice(0,12)).toEqual(['Customer A','Trip-1','INV-A','01-Sep-26','credit',100,18,118,59,0,59,0]);expect(table.rows[1][10]).toBe(59);
 });
 it('requires a party and includes historical opening in statements',async()=>{
 setup();await screen.findByText('TOTAL');fireEvent.change(screen.getByLabelText('Report'),{target:{value:'statement'}});expect(screen.queryByRole('button',{name:'PDF'})).toBeNull();
 fireEvent.change(screen.getByLabelText('Party'),{target:{value:'customer'}});fireEvent.change(screen.getByLabelText('From'),{target:{value:'2026-09-02'}});await waitFor(()=>expect((screen.getByRole('button',{name:'PDF'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'PDF'}));await waitFor(()=>expect(mock.export).toHaveBeenCalled());
 const table=mock.export.mock.calls[0][0];expect(table.rows[0][8]).toBe(118);expect(table.rows[1][8]).toBe(59);expect(table.rows[2][8]).toBe(59);
 });
 it('does not offer a canonical ledger without Accounting view permission',async()=>{
 mock.ledger=false;setup();await screen.findByText('TOTAL');expect((screen.getByRole('option',{name:'Complete canonical party ledger'}) as HTMLOptionElement).disabled).toBe(true);
 });
 it('does not export an empty success report after an API failure',async()=>{
 mock.fail=true;setup();await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'Excel'})).toBeNull();
 });
});
