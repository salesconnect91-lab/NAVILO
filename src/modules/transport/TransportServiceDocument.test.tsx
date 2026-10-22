// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import TransportServiceDocument from './TransportServiceDocument';

const mock=vi.hoisted(()=>({rpcCalls:[] as any[],status:'draft',sourceModule:'general_expense_bill'}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'company-1'},activeBusinessUnit:{business_unit_id:'bu-1'}})}));
vi.mock('@/modules/accounting/OwnerInvoiceCancellationReview',()=>({default:()=>null}));
vi.mock('@/modules/transport/ExternalInvoiceDetails',()=>({default:()=>null}));
vi.mock('@/modules/transport/ConfigurableReport',()=>({default:()=>null}));
vi.mock('@/components/PrintLayout',()=>({default:()=>null}));
vi.mock('@/lib/fetchAllPages',()=>({fetchAllPages:async(fetcher:any)=>{const result=await fetcher(0,499);return result.data??[];}}));
vi.mock('@/lib/supabase',()=>({supabase:{
  from:(table:string)=>{
  const q:any={select:()=>q,eq:()=>q,order:()=>q,range:async()=>({data:table==='purchase_service_lines'?[{id:'line-1',description:'Office repair',amount:100,tax_percent:15,source_module:mock.sourceModule}]:[],error:null}),
   single:async()=>({data:{id:'expense-1',status:mock.status,order_no:'EXP-1',order_date:'2026-10-21',supplier_invoice_no:'SUP-1',supplier_invoice_date:'2026-10-21',invoice_type:'Tax Invoice',total:115,outstanding_amount:115,party:{name:'Supplier One'}},error:null}),
   maybeSingle:async()=>({data:table==='transport_service_document_balances'?{billed_gross:115,outstanding_gross:115,credit_gross:0,paid_gross:0}:table==='transport_supplier_documents'?{document_kind:'service'}:null,error:null})};
  return q;
 },
 rpc:async(name:string,args:any)=>{mock.rpcCalls.push({name,args});return {data:name==='transport_document_trip_details'?[]:name==='transport_reverse_service_invoice'?{success:true,note_no:'TR-SVC-DN-1',total:115}:{success:true},error:null};}
}}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();mock.rpcCalls=[];mock.status='draft';mock.sourceModule='general_expense_bill';});

describe('supplier Expense Bill service document',()=>{
 it('lets users manually post a saved draft and routes payment to supplier payments',async()=>{
  render(<MemoryRouter><TransportServiceDocument side="supplier" id="expense-1" canPost/></MemoryRouter>);
  const post=await screen.findByRole('button',{name:'Post Expense Bill'});
  expect(screen.getByRole('heading',{name:'Expense Bill'})).toBeTruthy();
  expect(screen.getByText(/Supplier invoice: SUP-1/)).toBeTruthy();
  expect(screen.getByRole('link',{name:'Record or allocate payment in Accounting'}).getAttribute('href')).toBe('/accounting/cash-counter?mode=supplier');
  fireEvent.click(post);
  await waitFor(()=>expect(mock.rpcCalls).toContainEqual({name:'post_purchase_invoice',args:{p_order_id:'expense-1'}}));
 });
 it('posts a full service debit note while preserving the posted source invoice',async()=>{
  mock.status='posted';
  mock.sourceModule='transport';
  vi.stubGlobal('confirm',()=>true);
  render(<MemoryRouter><TransportServiceDocument side="supplier" id="expense-1" canReverse/></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button',{name:'Delete Posted Invoice'}));
  fireEvent.change(screen.getByLabelText('Reversal note date'),{target:{value:'2026-10-22'}});
  fireEvent.change(screen.getByLabelText('Reversal reason'),{target:{value:'Invoice entered in error'}});
  fireEvent.click(screen.getByRole('button',{name:'Post Full Debit Note'}));
  await waitFor(()=>expect(mock.rpcCalls).toContainEqual({name:'transport_reverse_service_invoice',args:{p_side:'supplier',p_order_id:'expense-1',p_note_date:'2026-10-22',p_reason:'Invoice entered in error'}}));
  expect(await screen.findByText(/Original invoice remains in history/)).toBeTruthy();
 });
});
