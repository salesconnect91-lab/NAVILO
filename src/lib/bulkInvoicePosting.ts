import {supabase} from '@/lib/supabase';

export type InvoiceSide='sales'|'purchase';
export type BulkPostResult={id:string;status:'posted'|'skipped'|'failed';message:string};
export type BulkPostSummary={posted:number;skipped:number;failed:number;results:BulkPostResult[]};
type InvoiceRow={
 id:string;status:string;document_kind:string|null;company_id:string;business_unit_id:string;
 order_no:string;total:number|string|null;customer_id?:string|null;supplier_id?:string|null;
 transport_source_invoice_id?:string|null;transport_billing_origin_id?:string|null;
 supplier_invoice_no?:string|null;supplier_invoice_date?:string|null;invoice_type?:string|null;
 purchase_person_employee_id?:string|null;
};

export const MAX_BULK_POST=50;
export function isSelectableDraft(row:{status?:string|null}):boolean{
 return String(row.status||'').toLowerCase()==='draft';
}
export function allowedServiceSource(modules:(string|null|undefined)[]):boolean{
 return modules.length>0&&modules.every(value=>
  !!value&&(value==='transport_normal'||value==='transport_normal_vehicle'||value==='general_expense'||value==='general_expense_bill'));
}
export function positiveAmount(value:unknown):boolean{return Number.isFinite(Number(value))&&Number(value)>0;}

async function checkCandidate(side:InvoiceSide,id:string,companyId:string,businessUnitId:string):Promise<{ok:true;row:InvoiceRow}|{ok:false;reason:string}>{
 const table=side==='sales'?'sales_orders':'purchase_orders';
 const fields=side==='sales'
  ? 'id,status,document_kind,company_id,business_unit_id,order_no,total,customer_id,transport_source_invoice_id,transport_billing_origin_id'
  : 'id,status,document_kind,company_id,business_unit_id,order_no,total,supplier_id,supplier_invoice_no,supplier_invoice_date,invoice_type,purchase_person_employee_id';
 const {data,error}=await supabase.from(table).select(fields).eq('id',id)
  .eq('company_id',companyId).eq('business_unit_id',businessUnitId).maybeSingle();
 if(error)throw error;
 const row=data as unknown as InvoiceRow|null;
 if(!row)return {ok:false,reason:'Invoice not found in the active company/business unit.'};
 if(!isSelectableDraft(row))return {ok:false,reason:'Invoice is no longer Draft; refresh the list.'};
 if(!(side==='sales'?row.customer_id:row.supplier_id))return {ok:false,reason:'Customer or supplier is missing.'};
 if(row.document_kind==='service'){
  const linesTable=side==='sales'?'sales_service_lines':'purchase_service_lines';
  // Bounded read; if a draft contains more than 500 lines it must be posted
  // individually after review, never with an incomplete bulk validation.
  const {data:lines,error:lineError}=await supabase.from(linesTable).select('id,source_module,amount')
   .eq('order_id',id).limit(501);
  if(lineError)throw lineError;
  if(!lines?.length||lines.length>500)return {ok:false,reason:'No lines, or too many lines for bulk review.'};
  const external=side==='sales'&&lines.every(x=>x.source_module==='external_transport');
  if(!external&&!allowedServiceSource(lines.map(x=>x.source_module)))
   return {ok:false,reason:'Trip-linked or unsupported service invoice: use its existing review/finalize/post flow.'};
  if(external){
   // External customer invoices have their own validated import sources and are
   // independent of the Trip Register. Only originals, never debit/credit notes.
   if(!row.order_no?.trim()||row.transport_source_invoice_id!==row.order_no||row.transport_billing_origin_id)
    return {ok:false,reason:'Original external invoice number/source mismatch; review individually.'};
   const {data:links,error:linkError}=await supabase.from('transport_external_invoice_lines')
    .select('sales_line_id,vehicle_id,source_company,source_reference')
    .eq('sales_order_id',id).limit(501);
   if(linkError)throw linkError;
   const lineIds=new Set(lines.map(x=>x.id));
   const refs=new Set<string>();
   const invalid=!links||links.length!==lines.length||links.some(link=>{
    const company=String(link.source_company||'').trim().toLowerCase();
    const reference=String(link.source_reference||'').trim().toLowerCase();
    const key=company+':'+reference;
    if(!lineIds.delete(link.sales_line_id)||!link.vehicle_id||!company||!reference||refs.has(key))return true;
    refs.add(key);
    return false;
   })||lineIds.size!==0;
   if(invalid)return {ok:false,reason:'External invoice vehicle/source links incomplete. Review imported invoice.'};
  }
  const net=lines.reduce((n,x)=>n+Number(x.amount||0),0);
  if(!positiveAmount(net))return {ok:false,reason:'Invoice amount is zero. Complete its description lines first.'};
  if(side==='purchase'&&!String(row.supplier_invoice_no||'').trim())return {ok:false,reason:'Supplier original invoice number is missing.'};
 }else if(row.document_kind==='inventory'){
  const linesTable=side==='sales'?'sales_order_lines':'purchase_order_lines';
  const {data:lines,error:lineError}=await supabase.from(linesTable).select('line_total')
   .eq('order_id',id).limit(501);
  if(lineError)throw lineError;
  if(!lines?.length||lines.length>500||!positiveAmount(lines.reduce((n,x)=>n+Number(x.line_total||0),0)))
   return {ok:false,reason:'Complete the inventory invoice lines and positive amount first.'};
  // Use the same purchase-person and supplier source-document prerequisites as the
  // individual inventory purchase screen, instead of bypassing its safeguards.
  if(side==='purchase'){
   if(!row.purchase_person_employee_id)return {ok:false,reason:'Purchase Person is missing; open invoice and save buyer.'};
   if(row.invoice_type==='Tax Invoice'&&(!row.supplier_invoice_no||!row.supplier_invoice_date))
    return {ok:false,reason:'Tax Purchase requires original supplier invoice number and date.'};
  }
 }else return {ok:false,reason:'Unknown invoice type. Review individually.'};
 return {ok:true,row};
}

export async function postSelectedInvoices({
 side,ids,companyId,businessUnitId,onProgress
}:{
 side:InvoiceSide;ids:string[];companyId:string;businessUnitId:string;onProgress?:(done:number,total:number)=>void
}):Promise<BulkPostSummary>{
 if(!companyId||!businessUnitId)throw new Error('Select the active company and business unit.');
 const unique=[...new Set(ids)].filter(Boolean);
 if(!unique.length||unique.length>MAX_BULK_POST)throw new Error('Select 1–50 draft invoices on the current page.');
 const results:BulkPostResult[]=[];
 for(const id of unique){
  try{
   const check=await checkCandidate(side,id,companyId,businessUnitId);
   if('reason' in check){results.push({id,status:'skipped',message:check.reason});continue;}
   const {data,error}=await supabase.rpc(side==='sales'?'post_sales_invoice':'post_purchase_invoice',{p_order_id:id});
   if(error)throw error;
   if(!data||data.success!==true||data.status&&data.status!=='posted')
    throw new Error(String(data?.error||data?.message||'Posting did not confirm success.'));
   results.push({id,status:'posted',message:'Posted and journal created.'});
  }catch(e:any){
   results.push({id,status:'failed',message:e?.message||'Posting outcome unknown; check invoice status before retrying.'});
  }finally{onProgress?.(results.length,unique.length);}
 }
 return {posted:results.filter(x=>x.status==='posted').length,
  skipped:results.filter(x=>x.status==='skipped').length,
  failed:results.filter(x=>x.status==='failed').length,results};
}
