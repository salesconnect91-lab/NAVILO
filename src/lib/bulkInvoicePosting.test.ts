// @vitest-environment jsdom
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {allowedServiceSource,isSelectableDraft,MAX_BULK_POST,postSelectedInvoices} from './bulkInvoicePosting';

const state=vi.hoisted(()=>({
 records:{} as Record<string,any>,lines:{} as Record<string,any[]>,links:{} as Record<string,any[]>,calls:[] as {name:string;id:string}[],
 rpcFailure:false,
}));
vi.mock('@/lib/supabase',()=>({supabase:{
 from:(table:string)=>{
  const q:any={_id:'',select:()=>q,eq:(col:string,val:string)=>{if(col==='id'||col==='order_id'||col==='sales_order_id')q._id=val;return q;},
   maybeSingle:async()=>({data:state.records[q._id]??null,error:null}),
   limit:async()=>({data:table==='transport_external_invoice_lines'?(state.links[q._id]??[]):(state.lines[q._id]??[]),error:null})};
  return q;
 },
 rpc:async(name:string,args:{p_order_id:string})=>{
  state.calls.push({name,id:args.p_order_id});
  return state.rpcFailure?{data:{success:false,message:'Rejected by accounting'},error:null}:{data:{success:true,status:'posted'},error:null};
 }
}}));
const row=(id:string,extra:Record<string,unknown>={})=>({
 id,status:'draft',document_kind:'service',company_id:'tenant',business_unit_id:'unit',
 order_no:'SUP-EXT-33',total:115,customer_id:'cust',supplier_id:'supp',
 supplier_invoice_no:'SUP-EXT-33',supplier_invoice_date:'2026-10-20',invoice_type:'Tax Invoice',
 purchase_person_employee_id:'buyer',...extra,
});
beforeEach(()=>{state.records={};state.lines={};state.links={};state.calls=[];state.rpcFailure=false});

describe('read-only bulk invoice preflight',()=>{
 it('allows draft invoices only, and whitelists normal non-trip service sources',()=>{
  expect(isSelectableDraft({status:'draft'})).toBe(true);
  expect(isSelectableDraft({status:'posted'})).toBe(false);
  expect(allowedServiceSource(['transport_normal','transport_normal_vehicle'])).toBe(true);
  expect(allowedServiceSource(['historical_register'])).toBe(false);
  expect(allowedServiceSource([])).toBe(false);
 });
 it('posts a complete Normal Purchase but skips Trip Rent, zero drafts and posted rows',async()=>{
  state.records={
   normal:row('normal'),trip:row('trip'),zero:row('zero'),posted:row('posted',{status:'posted'}),
  };
  state.lines={
   normal:[{source_module:'transport_normal',amount:100}],
   trip:[{source_module:'historical_register',amount:100}],
   zero:[{source_module:'transport_normal',amount:0}],
   posted:[{source_module:'transport_normal',amount:100}],
  };
  const result=await postSelectedInvoices({side:'purchase',ids:['normal','trip','zero','posted'],companyId:'tenant',businessUnitId:'unit'});
  expect(result).toMatchObject({posted:1,skipped:3,failed:0});
  expect(state.calls).toEqual([{name:'post_purchase_invoice',id:'normal'}]);
  expect(result.results[1].message).toMatch(/Trip-linked/);
 });
 it('rejects supplier invoices without original invoice number and uses the existing sales RPC',async()=>{
  state.records={
   invalid:row('invalid',{supplier_invoice_no:null}),sale:row('sale',{order_no:'INV-001'}),
  };
  state.lines={
   invalid:[{source_module:'transport_normal',amount:50}],
   sale:[{source_module:'transport_normal',amount:120}],
  };
  const result=await postSelectedInvoices({side:'purchase',ids:['invalid'],companyId:'tenant',businessUnitId:'unit'});
  expect(result.skipped).toBe(1);
  const sales=await postSelectedInvoices({side:'sales',ids:['sale'],companyId:'tenant',businessUnitId:'unit'});
  expect(sales.posted).toBe(1);
  expect(state.calls).toEqual([{name:'post_sales_invoice',id:'sale'}]);
 });
 it('posts only fully linked external-import Sales drafts using the canonical posting RPC',async()=>{
  const external={id:'line-1',source_module:'external_transport',amount:2900};
  const link={sales_line_id:'line-1',vehicle_id:'vehicle-a',source_company:'twakkal',source_reference:'TRIP-18373'};
  state.records={
   valid:row('valid',{order_no:'2026-03026',transport_source_invoice_id:'2026-03026'}),
   missing:row('missing',{order_no:'2026-03027',transport_source_invoice_id:'2026-03027'}),
   note:row('note',{order_no:'2026-03028',transport_source_invoice_id:'2026-03028',transport_billing_origin_id:'original'}),
  };
  state.lines={valid:[external],missing:[external],note:[external]};
  state.links={valid:[link],missing:[],note:[link]};
  const res=await postSelectedInvoices({side:'sales',ids:['valid','missing','note'],companyId:'tenant',businessUnitId:'unit'});
  expect(res).toMatchObject({posted:1,skipped:2,failed:0});
  expect(state.calls).toEqual([{name:'post_sales_invoice',id:'valid'}]);
 });
 it('accepts six imported Cash Bills when database canonical source references are lowercase',async()=>{
  const ids=['cash-1','cash-2','cash-3','cash-4','cash-5','cash-6'];
  for(let n=1;n<=6;n++){
   const id=ids[n-1];
   state.records[id]=row(id,{
    order_no:'Cash Bill-'+n,transport_source_invoice_id:'cash bill-'+n,
    payment_mode:'Cash',status:'draft',
   });
   state.lines[id]=[{id:'line-'+n,source_module:'external_transport',amount:n===3?12000:1000}];
   state.links[id]=[{sales_line_id:'line-'+n,vehicle_id:'vehicle-'+n,
    source_company:'twakkal',source_reference:'18'+(300+n)}];
  }
  const result=await postSelectedInvoices({
   side:'sales',ids,companyId:'tenant',businessUnitId:'unit',
  });
  expect(result).toMatchObject({posted:6,skipped:0,failed:0});
  expect(state.calls).toEqual(ids.map(id=>({name:'post_sales_invoice',id})));
 });
 it('still rejects different invoice identities despite case-insensitive matching',async()=>{
  state.records.wrong=row('wrong',{order_no:'Cash Bill-2',transport_source_invoice_id:'cash bill-99'});
  state.lines.wrong=[{id:'line-wrong',source_module:'external_transport',amount:1000}];
  state.links.wrong=[{sales_line_id:'line-wrong',vehicle_id:'v',source_company:'twakkal',source_reference:'18345'}];
  const result=await postSelectedInvoices({side:'sales',ids:['wrong'],companyId:'tenant',businessUnitId:'unit'});
  expect(result).toMatchObject({posted:0,skipped:1,failed:0});
  expect(state.calls).toHaveLength(0);
 });
 it('never claims success for a rejected posting, and limits the batch size',async()=>{
  state.records={candidate:row('candidate')};
  state.lines={candidate:[{source_module:'transport_normal',amount:200}]};
  state.rpcFailure=true;
  const res=await postSelectedInvoices({side:'sales',ids:['candidate'],companyId:'tenant',businessUnitId:'unit'});
  expect(res).toMatchObject({posted:0,failed:1});
  expect(res.results[0].message).toContain('Rejected');
  await expect(postSelectedInvoices({side:'sales',ids:Array.from({length:MAX_BULK_POST+1},(_,i)=>'id'+i),companyId:'tenant',businessUnitId:'unit'})).rejects.toThrow('1–50');
 });
 it('rejects missing or wrong company/BU records before any posting',async()=>{
  const result=await postSelectedInvoices({side:'sales',ids:['unavailable'],companyId:'tenant',businessUnitId:'unit'});
  expect(result).toMatchObject({posted:0,skipped:1,failed:0});
  expect(state.calls).toHaveLength(0);
 });
});
