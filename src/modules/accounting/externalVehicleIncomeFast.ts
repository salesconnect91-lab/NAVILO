import {supabase} from '@/lib/supabase';
import {fetchAllPages,fetchByIdChunks} from '@/lib/fetchAllPages';
import type {ExternalVehicleLedgerRow} from './transportIncomeBreakdown';

export type ExternalAttributionRow=ExternalVehicleLedgerRow&{revenue_account_id:string|null};
type Source={id:string;sales_order_id:string;sales_line_id:string;vehicle_id:string|null;vehicle_no:string|null};
type Line={id:string;amount:number|string;revenue_account_id:string|null};
type Bill={sales_order_id:string;journal_entry_id:string};
type Journal={id:string;entry_date:string;status:string;reversal_of_entry_id:string|null};
type Credit={external_line_id:string;note_id:string;net_amount:number|string};
type Note={id:string;journal_entry_id:string|null;status:string};
type Scope='branch'|'business_unit'|'company';
const batchSize=150;
const money=(amount:number|string)=>Number(amount);
const inPeriod=(journal:Journal|undefined,from:string,to:string)=>
 !!journal&&journal.status==='posted'&&journal.entry_date>=from&&journal.entry_date<=to;
const unique=(ids:string[])=>[...new Set(ids.filter(Boolean))];


/**
 * The external vehicle-contributions view performs a company-wide journal and
 * credit/reversal UNION before filters, and times out on a loaded production DB.
 * Read only indexed, scoped source rows and the exact related posted journals.
 * This is presentation-only: totals and journals still come from canonical P&L.
 */
export async function readExternalVehicleIncomeFast(args:{
 companyId:string;businessUnitId:string;locationId:string|null;
 scope:Scope;fromDate:string;toDate:string;
}):Promise<ExternalAttributionRow[]>{
 const {companyId,businessUnitId,locationId,scope,fromDate,toDate}=args;
 if(!companyId||scope!=='company'&&!businessUnitId||scope==='branch'&&!locationId)
  throw new Error('Complete accounting report scope is required');
 const sources=await fetchAllPages<Source>((from,to)=>{
  let q=supabase.from('transport_external_invoice_lines')
   .select('id,sales_order_id,sales_line_id,vehicle_id,vehicle_no')
   .eq('company_id',companyId);
  if(scope!=='company')q=q.eq('business_unit_id',businessUnitId);
  if(scope==='branch')q=q.eq('operating_location_id',locationId!);
  return q.order('id',{ascending:true}).range(from,to);
 },500);
 if(!sources.length)return [];
 if(sources.length>10000)throw new Error('External vehicle sources exceed safe reporting limit. Use a shorter date range.');
 for(const x of sources){
  if(!x.id||!x.sales_order_id||!x.sales_line_id||!x.vehicle_id||!x.vehicle_no?.trim())
   throw new Error('External vehicle evidence is incomplete');
 }
 const read=<T,>(table:string,fields:string,col:string,ids:string[])=>
  fetchByIdChunks<T>(unique(ids),async (chunk,from,to)=>{
   const r=await supabase.from(table).select(fields).eq('company_id',companyId)
    .in(col,chunk).range(from,to);
   return {data:r.data as unknown as T[]|null,error:r.error};
  },batchSize,500);
 const [lines,docs,credits]=await Promise.all([
  read<Line>('sales_service_lines','id,amount,revenue_account_id','id',sources.map(x=>x.sales_line_id)),
  read<Bill>('transport_customer_documents','sales_order_id,journal_entry_id','sales_order_id',sources.map(x=>x.sales_order_id)),
  read<Credit>('transport_external_credit_allocations','external_line_id,note_id,net_amount','external_line_id',sources.map(x=>x.id)),
 ]);
 const amounts=new Map(lines.map(line=>[line.id,line]));
 const billJournalIds=docs.map(x=>x.journal_entry_id);
 const notes=credits.length?await read<Note>('return_notes','id,journal_entry_id,status','id',credits.map(x=>x.note_id)):[];
 const noteJournalIds=notes.filter(x=>x.status==='posted'&&x.journal_entry_id).map(x=>x.journal_entry_id!);
 const journalIds=unique([...billJournalIds,...noteJournalIds]);
 const [journals,reversals]=await Promise.all([
  read<Journal>('journal_entries','id,entry_date,status,reversal_of_entry_id','id',journalIds),
  fetchByIdChunks<Journal>(journalIds,async (ids,from,to)=>{
   const r=await supabase.from('journal_entries')
    .select('id,entry_date,status,reversal_of_entry_id')
    .eq('company_id',companyId).eq('status','posted')
    .in('reversal_of_entry_id',ids).range(from,to);
   return {data:r.data as unknown as Journal[]|null,error:r.error};
  },batchSize,500),
 ]);
 const posted=new Map(journals.map(x=>[x.id,x]));
 const reverseByOriginal=new Map<string,Journal>();
 for(const row of reversals){
  if(row.reversal_of_entry_id){
   if(reverseByOriginal.has(row.reversal_of_entry_id))throw new Error('Multiple journal reversals found for one entry');
   reverseByOriginal.set(row.reversal_of_entry_id,row);
  }
 }
 const docsByOrder=new Map(docs.map(d=>[d.sales_order_id,d]));
 const sourcesById=new Map(sources.map(s=>[s.id,s]));
 const notesById=new Map(notes.map(n=>[n.id,n]));
 const result:ExternalAttributionRow[]=[];
 function add(src:Source,entry:Journal|undefined,value:number|string,sign:1|-1){
  if(!inPeriod(entry,fromDate,toDate))return;
  const line=amounts.get(src.sales_line_id);
  if(!line||!line.revenue_account_id||!Number.isFinite(money(value)))
   throw new Error('External invoice line amount or revenue account missing');
  result.push({event_id:'external:'+entry!.id+':'+src.id,
   account_id:src.vehicle_id,account_name:src.vehicle_no,
   revenue:Math.round(money(value)*100)*sign/100,
   revenue_account_id:line.revenue_account_id});
 }
 for(const src of sources){
  const doc=docsByOrder.get(src.sales_order_id);
  if(!doc)continue; // draft external invoices have no posted accounting evidence
  const orig=posted.get(doc.journal_entry_id);
  if(!orig||orig.status!=='posted')continue;
  const line=amounts.get(src.sales_line_id);
  if(!line)throw new Error('Posted external invoice is missing its amount');
  add(src,orig,line.amount,1);
  add(src,reverseByOriginal.get(orig.id),line.amount,-1);
 }
 for(const credit of credits){
  const src=sourcesById.get(credit.external_line_id);
  const note=notesById.get(credit.note_id);
  if(!src||!note||note.status!=='posted'||!note.journal_entry_id)continue;
  const orig=posted.get(note.journal_entry_id);
  if(!orig||orig.status!=='posted')continue;
  add(src,orig,credit.net_amount,-1);
  add(src,reverseByOriginal.get(orig.id),credit.net_amount,1);
 }
 return result;
}
