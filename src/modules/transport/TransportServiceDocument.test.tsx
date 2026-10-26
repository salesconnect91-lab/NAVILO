// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import TransportServiceDocument from './TransportServiceDocument';

const mock=vi.hoisted(()=>({rpcCalls:[] as any[],selectCalls:[] as any[],printProps:[] as any[],status:'draft',sourceModule:'general_expense_bill',serviceLines:[] as any[],customerDocument:null as any,canEditPosted:false,orderNo:'EXP-1'}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'company-1'},activeBusinessUnit:{business_unit_id:'bu-1'}})}));
vi.mock('@/modules/accounting/OwnerInvoiceCancellationReview',()=>({default:()=>null}));
vi.mock('@/modules/transport/ExternalInvoiceDetails',()=>({default:()=>null}));
vi.mock('@/modules/transport/ConfigurableReport',()=>({default:()=>null}));
vi.mock('@/components/PrintLayout',()=>({default:(props:any)=>{mock.printProps.push(props);return null;}}));
vi.mock('@/lib/fetchAllPages',()=>({fetchAllPages:async(fetcher:any)=>{const result=await fetcher(0,499);return result.data??[];}}));
vi.mock('@/lib/supabase',()=>({supabase:{
  from:(table:string)=>{
  const q:any={select:(columns:string)=>{mock.selectCalls.push({table,columns});return q;},eq:()=>q,order:()=>q,range:async()=>({data:table==='purchase_service_lines'?[{id:'line-1',description:'Office repair',amount:100,tax_percent:15,source_module:mock.sourceModule}]:table==='sales_service_lines'?mock.serviceLines:[],error:null}),
   single:async()=>({data:{id:'expense-1',status:mock.status,order_no:mock.orderNo,order_date:'2026-10-21',supplier_invoice_no:'SUP-1',supplier_invoice_date:'2026-10-21',invoice_type:'Tax Invoice',total:115,outstanding_amount:115,party:{name:'Supplier One'}},error:null}),
   maybeSingle:async()=>({data:table==='transport_service_document_balances'?{billed_gross:115,outstanding_gross:115,credit_gross:0,paid_gross:0}:table==='transport_supplier_documents'?{id:'supplier-doc-1',document_kind:'service',journal_entry_id:mock.sourceModule==='transport'?'journal-1':null}:table==='transport_customer_documents'?mock.customerDocument:null,error:null})};
  return q;
 },
 rpc:async(name:string,args:any)=>{mock.rpcCalls.push({name,args});return {data:name==='transport_posted_invoice_admin_access'?mock.canEditPosted:name==='transport_document_trip_details'?[]:name==='transport_reverse_service_invoice'?{success:true,note_no:'TR-SVC-DN-1',total:115}:name==='transport_delete_register_draft_invoice'?{deleted:true}:{success:true,journal_entry_id:'journal-1'},error:null};}
}}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();mock.rpcCalls=[];mock.selectCalls=[];mock.printProps=[];mock.status='draft';mock.sourceModule='general_expense_bill';mock.serviceLines=[];mock.customerDocument=null;mock.canEditPosted=false;mock.orderNo='EXP-1';});

describe('supplier Expense Bill service document',()=>{
 it('lets users manually post a saved draft and routes payment to supplier payments',async()=>{
  render(<MemoryRouter><TransportServiceDocument side="supplier" id="expense-1" canPost/></MemoryRouter>);
  const post=await screen.findByRole('button',{name:'Post Expense Bill'});
  expect(mock.selectCalls).toContainEqual({table:'transport_supplier_documents',columns:'journal_entry_id'});
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
  fireEvent.click(await screen.findByRole('button',{name:'Issue Debit Note'}));
  fireEvent.change(screen.getByLabelText('Reversal note date'),{target:{value:'2026-10-22'}});
  fireEvent.change(screen.getByLabelText('Reversal reason'),{target:{value:'Invoice entered in error'}});
  fireEvent.click(screen.getByRole('button',{name:'Post Full Debit Note'}));
  await waitFor(()=>expect(mock.rpcCalls).toContainEqual({name:'transport_reverse_service_invoice',args:{p_side:'supplier',p_order_id:'expense-1',p_note_date:'2026-10-22',p_reason:'Invoice entered in error'}}));
  expect(await screen.findByText(/Original invoice remains in history/)).toBeTruthy();
 });
 it('deletes a supplier transport draft through the guarded Register cascade',async()=>{
  vi.stubGlobal('confirm',()=>true);
  render(<MemoryRouter><TransportServiceDocument side="supplier" id="expense-1" canDelete/></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button',{name:'Delete Draft'}));
  await waitFor(()=>expect(mock.rpcCalls).toContainEqual({name:'transport_delete_register_draft_invoice',args:{p_side:'supplier',p_document_id:'supplier-doc-1'}}));
 });
});

it('prints the NAVILO purchase invoice number separately from the supplier reference',async()=>{
 mock.sourceModule='transport';
 render(<MemoryRouter><TransportServiceDocument side="supplier" id="expense-1"/></MemoryRouter>);
 await screen.findByRole('heading',{name:'Purchase Service Invoice'});
 await waitFor(()=>expect(mock.printProps[mock.printProps.length-1]?.voucherNo).toBe('EXP-1'));
 expect(mock.printProps[mock.printProps.length-1]?.extraFields).toContainEqual({label:'Supplier Invoice',value:'SUP-1'});
 expect(screen.getByText('NAVILO invoice #: EXP-1')).toBeTruthy();
});

it('loads the customer transport document classification when it is available',async()=>{
 render(<MemoryRouter><TransportServiceDocument side="customer" id="sale-1"/></MemoryRouter>);
 await screen.findByRole('heading',{name:'Tax Invoice'});
 expect(mock.selectCalls).toContainEqual({table:'transport_customer_documents',columns:'document_kind,journal_entry_id'});
});

it('exposes the same posted editor and actual delete controls to the scoped Admin',async()=>{
 mock.status='posted';mock.sourceModule='transport';mock.canEditPosted=true;
 mock.customerDocument={id:'customer-doc-1',document_kind:'credit',journal_entry_id:'journal-1'};
 mock.serviceLines=[{id:'service-line-1',description:'Transport service · Trip 37',amount:1250,tax_percent:15,source_module:'transport',source_id:'trip-37'}];
 render(<MemoryRouter><TransportServiceDocument side="customer" id="sale-1"/></MemoryRouter>);
 expect(await screen.findByRole('button',{name:'Edit Posted Invoice'})).toBeTruthy();
 expect(screen.getByRole('button',{name:'Delete Posted Invoice'})).toBeTruthy();
});

it('hides the posted in-place edit from non-admin users',async()=>{
 mock.status='posted';mock.sourceModule='transport';mock.canEditPosted=false;
 mock.customerDocument={id:'customer-doc-1',document_kind:'credit',journal_entry_id:'journal-1'};
 mock.serviceLines=[{id:'service-line-1',description:'Transport service · Trip 37',amount:1250,tax_percent:15,source_module:'transport',source_id:'trip-37'}];
 render(<MemoryRouter><TransportServiceDocument side="customer" id="sale-1"/></MemoryRouter>);
 await screen.findByRole('heading',{name:'Tax Invoice'});
 await waitFor(()=>expect(mock.rpcCalls).toContainEqual({name:'transport_posted_invoice_admin_access',args:undefined}));
 expect(screen.queryByRole('button',{name:'Edit Posted Invoice'})).toBeNull();
});


it('shows the saved manual customer invoice number on screen and print',async()=>{
 mock.orderNo='ZZ-TEST-CUST-B-20261025';
 render(<MemoryRouter><TransportServiceDocument side="customer" id="sale-1"/></MemoryRouter>);
 expect(await screen.findByText('Register invoice: ZZ-TEST-CUST-B-20261025')).toBeTruthy();
 await waitFor(()=>expect(mock.printProps[mock.printProps.length-1]?.voucherNo).toBe('ZZ-TEST-CUST-B-20261025'));
});

it('keeps an internal historical number out of the customer invoice header and print',async()=>{
 mock.orderNo='H-S-123';
 render(<MemoryRouter><TransportServiceDocument side="customer" id="sale-1"/></MemoryRouter>);
 expect(await screen.findByText('Register invoice: not entered')).toBeTruthy();
 await waitFor(()=>expect(mock.printProps[mock.printProps.length-1]?.voucherNo).toBe('—'));
});

it('labels the customer credit-note action without presenting it as permanent deletion',async()=>{
 mock.status='posted';mock.sourceModule='transport';
 mock.customerDocument={id:'customer-doc-1',document_kind:'credit',journal_entry_id:'journal-1'};
 mock.serviceLines=[{id:'line-1',description:'Trip 47',amount:2400,tax_percent:15,source_module:'transport'}];
 render(<MemoryRouter><TransportServiceDocument side="customer" id="sale-1" canReverse/></MemoryRouter>);
 expect(await screen.findByRole('button',{name:'Issue Credit Note'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Delete Posted Invoice'})).toBeNull();
});
