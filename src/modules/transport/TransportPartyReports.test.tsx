// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import TransportPartyReports from './TransportPartyReports';
const mock=vi.hoisted(()=>({export:vi.fn(),rpc:vi.fn(),ledger:true,fail:false}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'c',company_name:'Company'},activeBusinessUnit:{business_unit_id:'b',business_unit_name:'Transport'}})}));
vi.mock('./transportPartyExport',()=>({exportPartyReport:mock.export}));
vi.mock('@/lib/supabase',()=>{const from=(table:string)=>{
 const doc={side:'customer',order_id:'A',party_id:'customer',party_name:'Customer A',order_no:'INV-A',order_date:'2026-09-01',trip_ids:['trip'],trip_no:'Trip-1',kind:'credit',original_net:100,original_gross:118,journal_entry_id:'j',current_outstanding_gross:59,current_credit_gross:0};
 const bill={event_id:'b',side:'customer',party_id:'customer',party_name:'Customer A',order_id:'A',order_no:'INV-A',trip_no:'Trip-1',journal_entry_id:'j',entry_no:'J-1',event_date:'2026-09-01',created_at:'2026-09-01',event_type:'bill',debit:118,credit:0,amount:118,net_amount:100};
 const receipt={...bill,event_id:'p',event_date:'2026-09-02',created_at:'2026-09-02',event_type:'receipt',debit:0,credit:59,amount:-59,net_amount:-50};
 const rows:Record<string,unknown[]>={transport_party_documents:[doc],transport_party_movements:[bill,receipt],transport_canonical_party_movements:[bill,receipt],chart_of_accounts:[],customers:[{id:'customer',name:'Customer A'},{id:'unposted',name:'Unposted Customer'}],suppliers:[]};
 const q:any={};for(const m of ['select','eq','in','order','range'])q[m]=()=>q;q.then=(resolve:any)=>Promise.resolve({data:rows[table]??[],error:mock.fail?{message:'API unavailable'}:null}).then(resolve);return q;
};return {supabase:{from,rpc:async(name:string,args?:{p_kind:string})=>(mock.rpc(name),name==='transport_opening_invoice_query'?{data:[],error:null}:name==='transport_financial_read_allowed'?{data:true,error:null}:name==='transport_document_trip_detail_query'?{data:[{order_no:'INV-A',trip_no:'Trip-1',base_amount:90,charge_amount:10,tax_amount:18,total_amount:118,charge_breakdown:'Waiting 10.00'},{order_no:'INV-A',trip_no:'Trip-2',base_amount:90,charge_amount:10,tax_amount:18,total_amount:118,charge_breakdown:'Waiting 10.00'}],error:null}:name==='transport_party_report_query'?await from('transport_'+(args?.p_kind==='canonical'?'canonical_party_movements':args?.p_kind==='documents'?'party_documents':'party_movements')):{data:mock.ledger,error:null})}};});
beforeEach(()=>{mock.export.mockReset();mock.rpc.mockReset();mock.ledger=true;mock.fail=false});afterEach(cleanup);
function setup(){render(<TransportPartyReports onClose={()=>{}} onChanged={async()=>{}}/>)}
async function chooseCustomer(){await screen.findByRole('option',{name:'Customer A'});fireEvent.change(screen.getByLabelText('Party'),{target:{value:'customer'}});await screen.findByText('TOTAL')}
describe('Separate Transport party reporting',()=>{
 it('searches the party dropdown without fetching financial rows per keystroke',async()=>{
  setup();await screen.findByRole('option',{name:'Customer A'});
  const select=screen.getByLabelText('Party') as HTMLSelectElement;
  fireEvent.click(select.parentElement!.querySelector('[aria-haspopup="listbox"]')!);
  fireEvent.change(screen.getByPlaceholderText('Search customers or suppliers...'),{target:{value:'Unposted'}});
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option',{name:'Unposted Customer'}));
  expect(select.value).toBe('unposted');
 });
 it('applies trip/document search only when Search is clicked',async()=>{
  setup();await chooseCustomer();
  const before=mock.rpc.mock.calls.filter(([name])=>name==='transport_party_report_query').length;
  fireEvent.change(screen.getByLabelText('Trip / document search'),{target:{value:'Trip-1'}});
  expect(mock.rpc.mock.calls.filter(([name])=>name==='transport_party_report_query')).toHaveLength(before);
  fireEvent.click(screen.getByRole('button',{name:'Search'}));
  await waitFor(()=>expect(mock.rpc.mock.calls.filter(([name])=>name==='transport_party_report_query').length).toBeGreaterThan(before));
 });
 it('does not scan all party financial records when the report opens',async()=>{
  setup();await screen.findByRole('option',{name:'Customer A'});
  await waitFor(()=>expect((screen.getByRole('button',{name:'Load all parties (large report)'}) as HTMLButtonElement).disabled).toBe(false));
  expect(mock.rpc.mock.calls.some(([name])=>name==='transport_party_report_query'||name==='transport_opening_invoice_query'||name==='transport_document_trip_detail_query')).toBe(false);
  expect(screen.queryByRole('button',{name:'Excel'})).toBeNull();
 });
 it('exports the complete filtered VAT-inclusive outstanding with totals',async()=>{
 setup();await chooseCustomer();await waitFor(()=>expect((screen.getByRole('button',{name:'Excel'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Excel'}));await waitFor(()=>expect(mock.export).toHaveBeenCalled());
 const table=mock.export.mock.calls[0][0];expect(table.rows[0].slice(0,12)).toEqual(['Customer A','Trip-1','INV-A','01-Sep-26','credit',100,18,118,59,0,59,0]);expect(table.rows[1][10]).toBe(59);
 expect(table.rows[0][table.columns.indexOf('Document charges')]).toBe(10);
 expect(table.rows[0][table.columns.indexOf('Document gross')]).toBe(118);
 expect(table.rows[0][table.columns.indexOf('Charge description')]).toBe('Waiting 10.00');
 for(const row of table.rows)expect(row).toHaveLength(table.columns.length);
 });
 it('previews an outstanding row with open invoice and journal links',async()=>{
  setup();await chooseCustomer();fireEvent.click(screen.getByRole('button',{name:'View report row 1'}));
  const details=screen.getByRole('dialog',{name:'Report row details'});
  expect(details.parentElement?.classList.contains('navilo-transport-dialog')).toBe(true);
  expect(within(details).getByRole('link',{name:/Open sales invoice/}).getAttribute('href')).toBe('/sales/A');
  expect(within(details).getByRole('link',{name:/Open journal voucher/}).getAttribute('href')).toBe('/accounting/j');
  fireEvent.click(within(details).getByRole('button',{name:'Close'}));expect(screen.queryByRole('dialog',{name:'Report row details'})).toBeNull();
 });
 it('includes customer masters that have no posted invoices yet',async()=>{
 setup();await screen.findByRole('option',{name:'Unposted Customer'});expect(screen.getByRole('option',{name:'Unposted Customer'})).toBeTruthy();
 });
 it('requires a party and includes historical opening in statements',async()=>{
 setup();await screen.findByRole('option',{name:'Customer A'});fireEvent.change(screen.getByLabelText('Report'),{target:{value:'statement'}});expect(screen.queryByRole('button',{name:'PDF'})).toBeNull();
 fireEvent.change(screen.getByLabelText('Party'),{target:{value:'customer'}});fireEvent.change(screen.getByLabelText('From'),{target:{value:'2026-09-02'}});await waitFor(()=>expect((screen.getByRole('button',{name:'PDF'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'PDF'}));await waitFor(()=>expect(mock.export).toHaveBeenCalled());
 const table=mock.export.mock.calls[0][0];expect(table.rows[0][8]).toBe(118);expect(table.rows[1][8]).toBe(59);expect(table.rows[2][8]).toBe(59);
 });
 it('does not offer a canonical ledger without Accounting view permission',async()=>{
 mock.ledger=false;setup();await chooseCustomer();expect((screen.getByRole('option',{name:'Complete canonical party ledger'}) as HTMLOptionElement).disabled).toBe(true);
 });
 it('does not export an empty success report after an API failure',async()=>{
 mock.fail=true;setup();await chooseCustomer().catch(()=>{});await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'Excel'})).toBeNull();
 });
});
