// @vitest-environment jsdom
import {afterEach,describe,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import * as XLSX from 'xlsx';
const mock=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn()}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'company'},activeBusinessUnit:{business_unit_id:'transport'}})}));
vi.mock('@/lib/supabase',()=>({supabase:mock}));
vi.mock('@/components/SearchableSelect',()=>({default:({nativeCompatibility,preserveLabel,...props}:any)=><select {...props}/>}));
import TransportExternalInvoiceImport from './TransportExternalInvoiceImport';
afterEach(cleanup);
describe('external ready invoice upload',()=>{
 it('previews grouped vehicle lines and imports drafts with Sales Revenue without any trip or payment call',async()=>{
 mock.from.mockImplementation((table:string)=>{const result={data:table==='account_mappings'?{account_id:'sales'}:[{id:'sales',name:'Sales Revenue'},{id:'service',name:'Service Revenue'}],error:null};const q:any={select:()=>q,eq:()=>q,order:()=>q,range:()=>Promise.resolve(result),maybeSingle:()=>Promise.resolve(result)};return q;});
 mock.rpc.mockImplementation(async(name:string,args:any)=>({data:name==='transport_preview_external_invoices'?{rows:args.p_rows.map((r:any)=>({...r,import_status:'New',import_reason:''}))}:{invoices:2,lines:3},error:null}));
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
 ['TRIP NO.','DATE','INVOICED','Invoice / Bill Date','COMPANY NAME','PLATE #','RATE WITH COMPANY','TAX (%)','TAX AMOUNT','BILL AMOUNT','Cash/Credit','Discription'],
 ['1','2026-06-04','INV1','2026-08-31','Customer A','7979',100,15,15,115,'Credit','Service A'],
 ['2','2026-06-05','INV1','2026-08-31','Customer A','5731',200,15,30,230,'Credit','Service B'],
 ['3','2026-09-01','CLEARED ASAD','2026-09-01','Cash A','5731',50,0,0,50,'Cash','Cash service']
 ]),'Invoices');const buffer=XLSX.write(wb,{type:'array',bookType:'xlsx'});const file=new File([buffer],'Twakkal.xlsx');Object.defineProperty(file,'arrayBuffer',{value:async()=>buffer});
 render(<MemoryRouter><TransportExternalInvoiceImport/></MemoryRouter>);await waitFor(()=>expect((screen.getByLabelText('External revenue account') as HTMLSelectElement).value).toBe('sales'));
 fireEvent.change(screen.getByLabelText('External invoice file'),{target:{files:[file]}});
 await screen.findByText('Auto cash bill');expect(screen.getAllByText('INV1')).toHaveLength(2);
 fireEvent.click(screen.getByRole('button',{name:'Import Draft Invoices'}));await screen.findByRole('status');
 const posted=mock.rpc.mock.calls.find(([name])=>name==='transport_import_external_invoices')!;expect(posted[1].p_revenue_account_id).toBe('sales');expect(posted[1].p_rows[2].invoice_no).toBe('');expect(posted[1].p_rows[0].invoice_date).toBe('2026-08-31');
 expect(mock.rpc.mock.calls.map(([name])=>name)).toEqual(['transport_preview_external_invoices','transport_import_external_invoices']);
 });
});
