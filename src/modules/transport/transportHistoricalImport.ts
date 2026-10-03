import * as XLSX from 'xlsx';
import {importDate,parseTripWorkbook,type ImportRow} from './transportTripImport';
import {validMoney} from './transportTripEntry';

export const HISTORY_COLUMNS=['Source Record ID','Customer Posted','Customer Invoice Date','Customer VAT','Customer Gross','Customer Received','Customer Remaining','Supplier Posted','Supplier Invoice Date','Supplier VAT','Supplier Gross','Supplier Paid','Supplier Remaining'] as const;
export const PAYMENT_COLUMNS=['Source Record ID','Side','Date','Amount','Cash / Bank Account Code','Reference'] as const;
export type HistoricalPayment={side:'customer'|'supplier';date:string;amount:number;account_code:string;reference:string;account_id?:string;method?:string};
export type HistoricalRow=ImportRow&{source_id:string;customer_posted:boolean;supplier_posted:boolean;customer_date:string;supplier_date:string;customer_vat:boolean;supplier_vat:boolean;customer_gross:number;supplier_gross:number;received:number;paid:number;customer_remaining:number;supplier_remaining:number;payments:HistoricalPayment[]};
const str=(v:unknown)=>String(v??'').trim();
const key=(v:unknown)=>str(v).replace(/\s+/g,' ').toLowerCase();
const money=(v:unknown,label:string)=>{if(str(v)===''||!validMoney(str(v)))throw new Error(`${label}: nonnegative amount with up to two decimals required`);return Number(v);};
const yes=(v:unknown,label:string)=>{if(!['yes','no'].includes(key(v)))throw new Error(`${label}: Yes or No required`);return key(v)==='yes';};
const cents=(v:number)=>Math.round(v*100);
export function parseHistoricalWorkbook(buffer:ArrayBuffer):HistoricalRow[]{
 const w=XLSX.read(buffer,{type:'array',cellDates:false});const name=w.SheetNames.find(n=>key(n)==='trips');
 if(!name)throw new Error('Trips worksheet required.');
 const matrix=XLSX.utils.sheet_to_json<unknown[]>(w.Sheets[name],{header:1,defval:'',raw:true});
 const headers=(matrix[0]??[]).map(key);const missing=HISTORY_COLUMNS.filter(h=>!headers.includes(key(h)));
 if(missing.length)throw new Error('Historical import needs explicit accounting columns: '+missing.join(', ')+'. Download the historical template.');
 const paymentsName=w.SheetNames.find(n=>key(n)==='payments');
 const payments=paymentsName?XLSX.utils.sheet_to_json<Record<string,unknown>>(w.Sheets[paymentsName],{defval:''}):[];
 if(payments.length>100000)throw new Error('Maximum 100,000 payment allocations per historical file.');
 const bySource=new Map<string,HistoricalPayment[]>();
 for(const [i,p] of payments.entries()){
  if(Object.values(p).every(v=>str(v)===''))continue;
  const id=str(p['Source Record ID']),side=key(p.Side),date=importDate(p.Date),amount=money(p.Amount,`Payments row ${i+2}`);
  if(!id||!['customer','supplier'].includes(side)||!date||amount<=0||!str(p['Cash / Bank Account Code'])||!str(p.Reference))throw new Error(`Payments row ${i+2}: source ID, customer/supplier side, date, positive amount, account code and reference required`);
  const list=bySource.get(id)??[];if(list.length>=100)throw new Error(`Source ${id}: at most 100 payment allocations`);
  list.push({side:side as HistoricalPayment['side'],date,amount,account_code:str(p['Cash / Bank Account Code']),reference:str(p.Reference)});bySource.set(id,list);
 }
 const ids=new Set<string>();const rows=parseTripWorkbook(buffer).map(row=>{
  const data=matrix[row.rowNo-1];const get=(h:string)=>data[headers.indexOf(key(h))]??'';
  const errors:string[]=[];const id=str(get('Source Record ID'));
  if(!id||id.length>120||ids.has(id))errors.push('Unique Source Record ID (1–120 characters) required');ids.add(id);
  let details:Omit<HistoricalRow,keyof ImportRow|'source_id'|'payments'>={customer_posted:false,supplier_posted:false,customer_date:'',supplier_date:'',customer_vat:false,supplier_vat:false,customer_gross:0,supplier_gross:0,received:0,paid:0,customer_remaining:0,supplier_remaining:0};
  try{
   details={customer_posted:yes(get('Customer Posted'),'Customer Posted'),supplier_posted:yes(get('Supplier Posted'),'Supplier Posted'),customer_date:importDate(get('Customer Invoice Date')),supplier_date:importDate(get('Supplier Invoice Date')),customer_vat:yes(get('Customer VAT'),'Customer VAT'),supplier_vat:yes(get('Supplier VAT'),'Supplier VAT'),customer_gross:money(get('Customer Gross'),'Customer Gross'),supplier_gross:money(get('Supplier Gross'),'Supplier Gross'),received:money(get('Customer Received'),'Customer Received'),paid:money(get('Supplier Paid'),'Supplier Paid'),customer_remaining:money(get('Customer Remaining'),'Customer Remaining'),supplier_remaining:money(get('Supplier Remaining'),'Supplier Remaining')};
   for(const side of ['customer','supplier'] as const){
    const posted=details[`${side}_posted`],gross=details[`${side}_gross`],settled=side==='customer'?details.received:details.paid;
    if(posted&&(!details[`${side}_date`]||gross<=0))errors.push(`${side}: posted invoice date and positive gross required`);
    if(!posted&&(gross!==0||settled!==0||details[`${side}_remaining`]!==0||details[`${side}_vat`]))errors.push(`${side}: unposted side must have zero accounting amounts and no VAT`);
    if(cents(gross-settled)!==cents(details[`${side}_remaining`]))errors.push(`${side}: gross less settled must equal remaining`);
    if(cents((bySource.get(id)??[]).filter(p=>p.side===side).reduce((s,p)=>s+p.amount,0))!==cents(settled))errors.push(`${side}: Payments worksheet must reconcile to settled total`);
    if((bySource.get(id)??[]).some(p=>p.side===side&&p.date<details[`${side}_date`]))errors.push(`${side}: payment cannot precede invoice`);
   }
   // Old BuKu amounts are ambiguous; require an explicit reviewed mapping instead of dropping them.
   for(const [old,current] of [['received from company',details.received],['PAY TO DRIVER',details.paid],['remaining with company',details.customer_remaining],['REMAINING WITH US',details.supplier_remaining]] as const){
    if(str(get(old))!==''&&cents(money(get(old),old))!==cents(current))errors.push(`${old} does not match the explicit historical amount`);
   }
   for(const h of ['AMOUNT','paid commissin for trip'])if(str(get(h))!==''&&Number(get(h))!==0)errors.push(`${h}: unsupported expense/payment evidence. Reconcile separately before importing`);
  }catch(e){errors.push(e instanceof Error?e.message:'Invalid financial history');}
  return {...row,...details,source_id:id,payments:bySource.get(id)??[],errors};
 });
 for(const id of bySource.keys())if(!ids.has(id))throw new Error(`Payment references unknown Source Record ID: ${id}`);
 return rows;
}
export function historicalTotals(rows:HistoricalRow[]){const total={trips:rows.length,customer_gross:0,supplier_gross:0,received:0,paid:0,customer_remaining:0,supplier_remaining:0};for(const row of rows)for(const k of ['customer_gross','supplier_gross','received','paid','customer_remaining','supplier_remaining'] as const)total[k]+=cents(row[k]);for(const k of ['customer_gross','supplier_gross','received','paid','customer_remaining','supplier_remaining'] as const)total[k]/=100;return total;}
export async function parseHistoricalFile(buffer:ArrayBuffer):Promise<HistoricalRow[]>{
 if(typeof Worker==='undefined')return parseHistoricalWorkbook(buffer);
 const worker=new Worker(new URL('./transportHistoricalImport.worker.ts',import.meta.url),{type:'module'});
 return new Promise((resolve,reject)=>{worker.onmessage=event=>{worker.terminate();if(event.data.error)reject(new Error(event.data.error));else resolve(event.data.rows);};worker.onerror=()=>{worker.terminate();reject(new Error('Unable to read historical workbook'));};worker.postMessage(buffer,[buffer]);});
}
