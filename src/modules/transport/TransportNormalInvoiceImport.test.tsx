// @vitest-environment jsdom
import {afterEach,describe,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import * as XLSX from 'xlsx';

const mock=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn()}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'company'},activeBusinessUnit:{business_unit_id:'transport'}})}));
vi.mock('@/lib/supabase',()=>({supabase:mock}));
vi.mock('@/components/SearchableSelect',()=>({default:({nativeCompatibility,preserveLabel,...props}:any)=><select {...props}/> }));
import TransportNormalInvoiceImport from './TransportNormalInvoiceImport';

afterEach(()=>{cleanup();vi.clearAllMocks()});

function queryFor(table:string){
 const rows=table==='customers'?[{id:'customer',name:'Customer A'}]
  :table==='chart_of_accounts'?[{id:'sales',name:'Sales Revenue'}]
  :table==='transport_vehicles'?[{id:'vehicle',vehicle_no:'1631',ownership_type:'company'}]
  :[];
 const result={data:rows,error:null};
 const q:any={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,range:async()=>result,maybeSingle:async()=>({data:{account_id:'sales'},error:null}),then:(resolve:any,reject:any)=>Promise.resolve(result).then(resolve,reject)};
 return q;
}

describe('Normal invoice Import Center draft workflow',()=>{
 it('imports the selected invoice as a draft and offers no post-on-import action',async()=>{
  mock.from.mockImplementation(queryFor);
  mock.rpc.mockResolvedValue({data:{invoices:1,lines:1},error:null});
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
   ['Invoice Group','Invoice No','Date','Customer','Description','Vehicle No','Amount','Reference','VAT Treatment'],
   ['INV-1','ORIGINAL-1','2026-10-17','Customer A','Service','1631',300,'REF-1','Master']
  ]),'Normal Invoices');
  const buffer=XLSX.write(wb,{type:'array',bookType:'xlsx'});
  const file=new File([buffer],'normal-invoice.xlsx');
  Object.defineProperty(file,'arrayBuffer',{value:async()=>buffer});

  render(<MemoryRouter><TransportNormalInvoiceImport side="customer"/></MemoryRouter>);
  const importButton=await screen.findByRole('button',{name:'Choose Excel/CSV'});
  expect((importButton as HTMLButtonElement).disabled).toBe(false);
  fireEvent.change(screen.getByLabelText('Normal Sale import file'),{target:{files:[file]}});
  await screen.findByText(/1 invoices · 1 lines/);
  expect(screen.queryByRole('button', {name:/Import & Post/i})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Import 1 Sale Invoice Drafts'}));

  await screen.findByRole('status');
  expect(mock.rpc).toHaveBeenCalledWith('transport_normal_invoice_import_vat',{
   p_side:'customer',p_rows:expect.arrayContaining([expect.objectContaining({invoice_no:'ORIGINAL-1'})]),p_post:false
  });
  expect(screen.getByRole('status').textContent).toContain('saved as draft');
 });
});
