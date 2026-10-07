// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import TransportBulkCustomerRate from './TransportBulkCustomerRate';
import TransportBulkSupplierRent from './TransportBulkSupplierRent';
import {invoiceNumberError} from './transportInvoiceNumbers';
import {bulkLines,loadBulkTrips,validBulkMoney,type BulkTrip} from './transportBulkRates';

const mock=vi.hoisted(()=>({rpc:vi.fn(),trips:[] as any[],tables:{} as Record<string,any[]>,allowed:true,failCash:false,failCorrection:false}));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:{company_id:'company'},activeBusinessUnit:{business_unit_id:'unit'}})}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc,from:(table:string)=>{
 const q:any={};let from=0,to=999;
 for(const method of ['select','eq','in','order'])q[method]=()=>q;
 q.range=(a:number,b:number)=>{from=a;to=b;return q};
 q.then=(resolve:any)=>Promise.resolve({data:(mock.tables[table]??[]).slice(from,to+1),error:null}).then(resolve);return q;
}}}));
const trip={id:'trip',trip_no:'TRP-1',trip_date:'2026-10-01',customer_id:'customer',customer_name:'Customer A',trip_status:'completed',financial_status:'Under Settlement',customer_rate:100,customer_rate_state:'finalized',sale_type:'credit',owner_supplier_id:'supplier-a',owner_name:'Supplier A'};
beforeEach(()=>{
 mock.allowed=true;mock.failCash=false;mock.failCorrection=false;mock.trips=[{...trip}];
 mock.tables={customers:[{id:'customer',name:'Customer A',is_active:true}],suppliers:[{id:'supplier-a',name:'Supplier A',is_active:true},{id:'supplier-b',name:'Supplier B',is_active:true}],
 chart_of_accounts:[{id:'expense',name:'Transport Expense',type:'expense'},{id:'cash',name:'Cash',type:'asset',detail_type:'Cash on Hand'}],
 transport_trip_supplier_rents:[{id:'rent-a',trip_id:'trip',supplier_id:'supplier-a',amount:70,state:'finalized'},{id:'rent-b',trip_id:'trip',supplier_id:'supplier-b',amount:30,state:'finalized'}],
 transport_supplier_document_rents:[],transport_rate_adjustments:[]};
 mock.rpc.mockReset();mock.rpc.mockImplementation(async(name:string,args:any)=>{
  if(name==='transport_bulk_rate_page'){
   const f=args.p_filters;let rows=mock.trips.map(t=>({...t,posted:!!(t.customer_rate_locked||t.invoiced||t.sales_order_id)}));
   if(args.p_side==='supplier')rows=bulkLines('supplier',mock.trips,mock.tables.transport_trip_supplier_rents,new Set(mock.tables.transport_supplier_document_rents.map(l=>l.rent_id)),mock.tables.transport_rate_adjustments,mock.tables.suppliers).map(l=>({...l.trip,id:l.key,trip_id:l.trip.id,party_id:l.partyId,owner_name:l.partyName,posted:l.posted,legacyBlocked:l.legacyBlocked,supplier_rent:l.amount,billed_supplier_net:l.posted?l.amount:null,rent:l.rent?{...l.rent,trip_id:l.trip.id,amount:l.amount,finalized_amount_snapshot:l.amount}:null}));
   const statuses=[...new Set(rows.map(r=>r.trip_status))];
   rows=rows.filter(r=>(!f.party||(args.p_side==='customer'?r.customer_id:r.party_id)===f.party)&&(!f.status||r.trip_status===f.status)&&(!f.columns?.trip||r.trip_no.toLowerCase().includes(f.columns.trip.toLowerCase())));
   return {data:{rows:rows.slice(args.p_offset,args.p_offset+args.p_limit),count:rows.length,statuses,amount:rows.reduce((s,r)=>s+Number(r.supplier_rent??r.customer_rate??0),0)},error:null};
  }
  if(name==='transport_financial_register_page')return {data:mock.trips.slice(args.p_offset,args.p_offset+args.p_limit),error:null};
  if(['transport_finance_allowed','has_transport_action_permission'].includes(name))return {data:mock.allowed,error:null};
  return {data:{success:true},error:(['transport_post_cash_bill_receive','transport_post_cash_bill_receive_numbered'].includes(name)&&mock.failCash)||(name==='transport_adjust_rate'&&mock.failCorrection)?{message:'Network interrupted'}:null};
 });
});
afterEach(cleanup);
describe('Compact supplier rate popup',()=>{
 it('keeps Save Rate disabled without the existing rent permissions',async()=>{
  mock.allowed=false;render(<TransportBulkSupplierRent compact initialTripId="trip" initialSupplierName="Supplier A" onClose={vi.fn()} onChanged={async()=>{}}/>);
  await screen.findByLabelText('Supplier rate excluding VAT');
  fireEvent.change(screen.getByLabelText('Supplier rate excluding VAT'),{target:{value:'75'}});fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Supplier agreed rent revised'}});
  expect((screen.getByRole('button',{name:'Save Rate'}) as HTMLButtonElement).disabled).toBe(true);
 });
 it('saves the selected Trip rent without opening a bulk table or posting an invoice',async()=>{
  const close=vi.fn();render(<TransportBulkSupplierRent compact initialTripId="trip" initialSupplierName="Supplier A" onClose={close} onChanged={async()=>{}}/>);
  const input=await screen.findByLabelText('Supplier rate excluding VAT');
  expect(screen.getByRole('dialog').className).toContain('max-w-sm');
  expect(screen.queryByRole('table')).toBeNull();
  fireEvent.change(input,{target:{value:'75'}});fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Supplier agreed rent revised'}});
  fireEvent.click(screen.getByRole('button',{name:'Save Rate'}));
  await waitFor(()=>expect(close).toHaveBeenCalled());
  expect(mock.rpc).toHaveBeenCalledWith('transport_finalize_supplier_rent',{p_rent_id:'rent-a',p_amount:75,p_reason:'Supplier agreed rent revised'});
  expect(mock.rpc.mock.calls.some(([name])=>name==='transport_add_supplier_rent')).toBe(false);
  expect(mock.rpc.mock.calls.some(([name])=>name.startsWith('transport_post_supplier_bill'))).toBe(false);
  expect(mock.rpc.mock.calls.filter(([name])=>name==='transport_bulk_rate_page').every(([,args])=>args.p_filters.initialTrip==='trip')).toBe(true);
 });
 it('keeps multiple supplier rents separate and corrects only the selected posted rent',async()=>{
  mock.tables.transport_supplier_document_rents=[{id:'link-a',rent_id:'rent-a'},{id:'link-b',rent_id:'rent-b'}];
  render(<TransportBulkSupplierRent compact initialTripId="trip" initialSupplierName="Supplier A" onClose={vi.fn()} onChanged={async()=>{}}/>);
  await screen.findByLabelText('Supplier rate excluding VAT');
  fireEvent.change(screen.getByLabelText('Supplier rent'),{target:{value:'rent-b'}});
  await waitFor(()=>expect((screen.getByLabelText('Supplier rate excluding VAT') as HTMLInputElement).value).toBe('30'));
  fireEvent.change(screen.getByLabelText('Supplier rate excluding VAT'),{target:{value:'35'}});fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Supplier confirmation received'}});
  fireEvent.click(screen.getByRole('button',{name:'Post Correction'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_adjust_rate',expect.objectContaining({p_trip_id:'trip',p_rent_id:'rent-b',p_side:'supplier',p_new_rate:35})));
 });
});
describe('Transport Customer / Supplier bulk parity',()=>{
 it('loads beyond the first 1000 Trips',async()=>{
  mock.trips=Array.from({length:1001},(_,i)=>({...trip,id:String(i)}));
  expect(await loadBulkTrips()).toHaveLength(1001);
  expect(mock.rpc).toHaveBeenCalledWith('transport_financial_register_page',{p_limit:1000,p_offset:1000});
 });
 it('keeps each supplier rent and correction amount separate even when Trip total differs',async()=>{
  mock.trips=[{...trip,supplier_rate_locked:true,billed_supplier_net:100}];
  mock.tables.transport_supplier_document_rents=[{id:'link-a',rent_id:'rent-a'}];
  mock.tables.transport_rate_adjustments=[{id:'adjustment-a',trip_id:'trip',rent_id:'rent-a',side:'supplier',difference:-10}];
  render(<TransportBulkSupplierRent onClose={vi.fn()} onChanged={async()=>{}}/>);
  await screen.findByRole('option',{name:'Supplier B'});
  expect((screen.getByLabelText('Rent TRP-1 Supplier A') as HTMLInputElement).value).toBe('60');
  expect((screen.getByLabelText('Rent TRP-1 Supplier A') as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText('Rent TRP-1 Supplier B') as HTMLInputElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Correct Rent'}));
  expect((screen.getByLabelText('New Rent') as HTMLInputElement).value).toBe('60');
  fireEvent.change(screen.getByLabelText('New Rent'),{target:{value:'65'}});
  fireEvent.change(screen.getByLabelText('Correction Reason'),{target:{value:'Agreed correction'}});
  fireEvent.click(screen.getByRole('button',{name:'Save Correction'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_adjust_rate',expect.objectContaining({p_trip_id:'trip',p_rent_id:'rent-a',p_new_rate:65,p_side:'supplier'})));
 });
 it('posts only the selected supplier rent from a multi-supplier Trip',async()=>{
  render(<TransportBulkSupplierRent onClose={vi.fn()} onChanged={async()=>{}}/>);
  await screen.findByRole('option',{name:'Supplier B'});
  fireEvent.change(screen.getByLabelText('Supplier'),{target:{value:'supplier-b'}});
  expect(screen.queryByLabelText('Rent TRP-1 Supplier A')).toBeNull();
  await waitFor(()=>expect(screen.getByLabelText('Rent TRP-1 Supplier B')).toBeTruthy());
  fireEvent.click(screen.getByRole('button',{name:'Select Page Unposted'}));
  fireEvent.change(screen.getByLabelText('Expense account'),{target:{value:'expense'}});
  fireEvent.click(screen.getByRole('button',{name:'Post Finalized Selected'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_post_supplier_bill',expect.objectContaining({p_rent_id:'rent-b'})));
  expect(mock.rpc.mock.calls.filter(([n])=>n==='transport_post_supplier_bill')).toHaveLength(1);
  expect(mock.rpc.mock.calls.some(([n])=>/settle|pay_supplier/.test(n))).toBe(false);
  expect(screen.queryByLabelText('Cash / Bank')).toBeNull();
 });
 it.each(['customer','supplier'] as const)('keeps %s posted after full credit to zero',async side=>{
  mock.trips=[{...trip,customer_rate_locked:true,supplier_rate_locked:true,billed_customer_net:0,billed_supplier_net:0}];
  mock.tables.transport_trip_supplier_rents=[{id:'rent-a',trip_id:'trip',supplier_id:'supplier-a',amount:70,state:'finalized'}];
  mock.tables.transport_supplier_document_rents=[{id:'link-a',rent_id:'rent-a'}];
  mock.tables.transport_rate_adjustments=[{id:'adj',trip_id:'trip',rent_id:'rent-a',side:'supplier',difference:-70}];
  render(side==='customer'?<TransportBulkCustomerRate onClose={vi.fn()} onChanged={async()=>{}}/>:<TransportBulkSupplierRent onClose={vi.fn()} onChanged={async()=>{}}/>);
  await screen.findByRole('button',{name:side==='customer'?'Correct Rate':'Correct Rent'});
  expect((screen.getByLabelText(side==='customer'?'Rate TRP-1':'Rent TRP-1 Supplier A') as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole('button',{name:'Select Page Unposted'}) as HTMLButtonElement).disabled).toBe(true);
 });
 it.each(['', 'MY-CASH-1'])('posts a Cash Trip invoice without auto receipt or settlement permission (%s)',async invoiceNo=>{
  mock.trips=[{...trip,sale_type:'cash'}];
  const rpc=mock.rpc.getMockImplementation()!;
  mock.rpc.mockImplementation((name:string,args:any)=>name==='transport_finance_allowed'&&args.p_action==='settlement'?Promise.resolve({data:false,error:null}):rpc(name,args));
  render(<TransportBulkCustomerRate onClose={vi.fn()} onChanged={async()=>{}}/>);
  await screen.findByRole('option',{name:'Customer A'});
  expect(screen.queryByLabelText('Cash / Bank')).toBeNull();
  if(invoiceNo)fireEvent.change(screen.getByLabelText('Invoice number TRP-1'),{target:{value:invoiceNo}});
  fireEvent.click(screen.getByRole('button',{name:'Select Page Unposted'}));
  fireEvent.click(screen.getByRole('button',{name:'Post Finalized Selected'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith(invoiceNo?'transport_post_customer_bill_numbered':'transport_post_customer_bill',expect.objectContaining({p_trip_id:'trip',p_with_tax:false,...(invoiceNo?{p_invoice_no:invoiceNo}:{})})));
  expect(mock.rpc.mock.calls.some(([n])=>/cash_bill_receive|settle|receive_customer_payment|pay_supplier/.test(n))).toBe(false);
 });
 it.each(['customer','supplier'] as const)('posts %s custom description with the editable invoice number',async side=>{
  render(side==='customer'?<TransportBulkCustomerRate onClose={vi.fn()} onChanged={async()=>{}}/>:<TransportBulkSupplierRent onClose={vi.fn()} onChanged={async()=>{}}/>);
  await screen.findByRole('option',{name:side==='customer'?'Customer A':'Supplier A'});
  if(side==='supplier'){
   fireEvent.change(screen.getByLabelText('Supplier'),{target:{value:'supplier-a'}});
   fireEvent.change(screen.getByLabelText('Expense account'),{target:{value:'expense'}});
  }
  const suffix=side==='customer'?'TRP-1':'TRP-1 Supplier A';
  fireEvent.change(await screen.findByLabelText(`Description ${suffix}`),{target:{value:'  Special delivery instructions  '}});
  fireEvent.change(screen.getByLabelText(`Invoice number ${suffix}`),{target:{value:'DESC-001'}});
  fireEvent.click(screen.getByRole('button',{name:'Select Page Unposted'}));
  fireEvent.click(screen.getByRole('button',{name:'Post Finalized Selected'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith(side==='customer'?'transport_post_customer_bill_described':'transport_post_supplier_bill_described',expect.objectContaining({p_invoice_no:'DESC-001',p_description:'Special delivery instructions'})));
  expect(mock.rpc.mock.calls.some(([n])=>/cash_bill_receive|settle|pay_supplier/.test(n))).toBe(false);
 });
 it.each(['customer','supplier'] as const)('disables %s actions when server permissions deny them',async side=>{
  mock.allowed=false;
  render(side==='customer'?<TransportBulkCustomerRate onClose={vi.fn()} onChanged={async()=>{}}/>:<TransportBulkSupplierRent onClose={vi.fn()} onChanged={async()=>{}}/>);
  await screen.findByRole('option',{name:side==='customer'?'Customer A':'Supplier A'});
  expect((screen.getByRole('button',{name:'Select Page Unposted'}) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button',{name:'Finalize Selected'}) as HTMLButtonElement).disabled).toBe(true);
 });
 it.each(['customer','supplier'] as const)('filters %s operational status and columns consistently',async side=>{
  render(side==='customer'?<TransportBulkCustomerRate onClose={vi.fn()} onChanged={async()=>{}}/>:<TransportBulkSupplierRent onClose={vi.fn()} onChanged={async()=>{}}/>);
  await screen.findByRole('option',{name:'completed'});
  expect(screen.queryByRole('option',{name:'Under Settlement'})).toBeNull();
  fireEvent.change(screen.getByLabelText('Filter trip'),{target:{value:'missing'}});
  expect(screen.queryByText('TRP-1')).toBeNull();
 });
 it('keeps a failed correction open for review',async()=>{
  mock.failCorrection=true;mock.trips=[{...trip,customer_rate_locked:true,billed_customer_net:100}];
  render(<TransportBulkCustomerRate onClose={vi.fn()} onChanged={async()=>{}}/>);
  await screen.findByRole('button',{name:'Correct Rate'});fireEvent.click(screen.getByRole('button',{name:'Correct Rate'}));
  fireEvent.change(screen.getByLabelText('New Rate'),{target:{value:'110'}});fireEvent.change(screen.getByLabelText('Correction Reason'),{target:{value:'Reason'}});
  fireEvent.click(screen.getByRole('button',{name:'Save Correction'}));await screen.findByRole('alert');expect(screen.getByLabelText('New Rate')).toBeTruthy();
 });
 it.each(['customer','supplier'] as const)('posts the chosen %s invoice number through canonical numbered posting',async side=>{
  render(side==='customer'?<TransportBulkCustomerRate onClose={vi.fn()} onChanged={async()=>{}}/>:<TransportBulkSupplierRent onClose={vi.fn()} onChanged={async()=>{}}/>);
  await screen.findByRole('option',{name:side==='customer'?'Customer A':'Supplier A'});
  const label=side==='customer'?'Invoice number TRP-1':'Invoice number TRP-1 Supplier A';
  fireEvent.change(screen.getByLabelText(label),{target:{value:'  MY-INV-2026  '}});
  if(side==='supplier')fireEvent.change(screen.getByLabelText('Expense account'),{target:{value:'expense'}});
  fireEvent.click(screen.getByLabelText(side==='customer'?'Select TRP-1':'Select TRP-1 Supplier A'));
  fireEvent.click(screen.getByRole('button',{name:'Post Finalized Selected'}));
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith(side==='customer'?'transport_post_customer_bill_numbered':'transport_post_supplier_bill_numbered',expect.objectContaining({p_invoice_no:'MY-INV-2026'})));
 });
 it('locks invoice numbering on posted trips',async()=>{
  mock.trips=[{...trip,customer_rate_locked:true,invoice_no:'S-OLD'}];
  render(<TransportBulkCustomerRate onClose={vi.fn()} onChanged={async()=>{}}/>);
  await screen.findByRole('button',{name:'Correct Rate'});
  expect((screen.getByLabelText('Invoice number TRP-1') as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText('Invoice number TRP-1') as HTMLInputElement).value).toBe('S-OLD');
 });
 it('rejects duplicate batch invoice numbers before posting any row',()=>{
  expect(invoiceNumberError([' A-1 ','a-1'])).toContain('Duplicate');
  expect(invoiceNumberError(['','  ','A-1','A-2'])).toBeNull();
  expect(invoiceNumberError(['BAD-AUTO'])).toContain('reserved');
 });
 it('rejects blank, nonfinite, negative and fractional-cent rates',()=>{
  for(const value of ['','-1','Infinity','NaN','1.001'])expect(validBulkMoney(value)).toBe(false);
  expect(validBulkMoney('0')).toBe(true);expect(validBulkMoney('12.34')).toBe(true);
 });
 it('does not let Trip-wide posted flags block another unposted supplier rent',()=>{
  const rows=bulkLines('supplier',[{...trip,supplier_rate_locked:true} as BulkTrip],mock.tables.transport_trip_supplier_rents,new Set(['rent-a']),[],mock.tables.suppliers);
  expect(rows.map(r=>[r.key,r.posted])).toEqual([['rent-a',true],['rent-b',false]]);
 });
});


describe('Bulk rate filter typing',()=>{
 it.each(['customer','supplier'] as const)('keeps %s filters usable during a pending reload',async side=>{
  render(side==='customer'?<TransportBulkCustomerRate onClose={vi.fn()} onChanged={async()=>{}}/>:<TransportBulkSupplierRent onClose={vi.fn()} onChanged={async()=>{}}/>);
  await screen.findByLabelText(side==='customer'?'Rate TRP-1':'Rent TRP-1 Supplier A');
  const rpc=mock.rpc.getMockImplementation()!;
  let finish:()=>void=()=>{};
  const pending=new Promise<any>(resolve=>{finish=()=>resolve({data:{rows:[],count:0,statuses:['completed'],amount:0},error:null})});
  mock.rpc.mockImplementation((name:string,args:any)=>name==='transport_bulk_rate_page'?pending:rpc(name,args));
  const filter=screen.getByLabelText('Filter trip') as HTMLInputElement;
  fireEvent.change(filter,{target:{value:'TR'}});
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_bulk_rate_page',expect.objectContaining({p_filters:expect.objectContaining({columns:expect.objectContaining({trip:'TR'})})})));
  expect(filter.disabled).toBe(false);
  fireEvent.change(filter,{target:{value:'TRP-1'}});
  await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_bulk_rate_page',expect.objectContaining({p_filters:expect.objectContaining({columns:expect.objectContaining({trip:'TRP-1'})})})));
  expect(filter.value).toBe('TRP-1');
  finish();
 });
});

it('requires supplier VAT source reference and posts the reference separately from NAVILO numbering',async()=>{
 const original=mock.rpc.getMockImplementation()!;mock.rpc.mockImplementation((name:string,args:any)=>name==='fixed_tax_rate_on'?Promise.resolve({data:18,error:null}):original(name,args));
 render(<TransportBulkSupplierRent onClose={vi.fn()} onChanged={async()=>{}}/>);await screen.findByRole('option',{name:'Supplier B'});
 fireEvent.change(screen.getByLabelText('Supplier'),{target:{value:'supplier-b'}});await waitFor(()=>expect(screen.getByLabelText('Rent TRP-1 Supplier B')).toBeTruthy());
 fireEvent.click(screen.getByRole('button',{name:'Select Page Unposted'}));fireEvent.change(screen.getByLabelText('Expense account'),{target:{value:'expense'}});fireEvent.click(screen.getByLabelText('With VAT'));
 await screen.findByText(/VAT 18%: 5.40/);fireEvent.click(screen.getByRole('button',{name:'Post Finalized Selected'}));
 await screen.findByText(/original supplier invoice reference required/);expect(mock.rpc.mock.calls.some(([n])=>n==='transport_post_supplier_bill')).toBe(false);
 fireEvent.change(screen.getByLabelText('Supplier invoice reference TRP-1 Supplier B'),{target:{value:'SUP-VAT-77'}});
 fireEvent.click(screen.getByRole('button',{name:'Post Finalized Selected'}));
 await waitFor(()=>expect(mock.rpc).toHaveBeenCalledWith('transport_post_supplier_bill',expect.objectContaining({p_rent_id:'rent-b',p_with_tax:true,p_reference:'SUP-VAT-77'})));
});
