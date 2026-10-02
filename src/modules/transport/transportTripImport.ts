import * as XLSX from 'xlsx';

export type ImportRow = {
 rowNo:number;trip_date:string;customer:string;truck_type:string;vehicle:string;driver:string;owner_supplier:string;
 po_do_job_no:string;from_location:string;to_location:string;ppr_status:string;customer_rate:string;supplier_rent:string;
 source_invoice_no:string;notes:string;sale_type:string;driver_pay:string;ppr_employee:string;ppr_date:string;
 payload?:Record<string,unknown>;errors:string[];
};
const text=(value:unknown)=>String(value??'').trim();
const key=(value:unknown)=>text(value).replace(/\s+/g,' ').toLowerCase();
export function tripImportIdentity(row:ImportRow,masters:Partial<Record<'customer'|'vehicle'|'driver'|'from'|'to',string>>={}) {
 const identity=(id:string|undefined,name:string)=>id?['id',id]:['name',key(name)];
 return JSON.stringify([row.trip_date,identity(masters.customer,row.customer),identity(masters.vehicle,row.vehicle),
  identity(masters.driver,row.driver),key(row.po_do_job_no),identity(masters.from,row.from_location),identity(masters.to,row.to_location)]);
}
export function importDate(value:unknown):string {
 if(value instanceof Date) return Number.isNaN(value.getTime())?'':`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
 if(typeof value==='number') {const d=XLSX.SSF.parse_date_code(value);return d?`${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`:'';}
 const raw=text(value);let y:number,m:number,d:number;
 const iso=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
 const short=raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
 const named=raw.match(/^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{2}|\d{4})$/);
 if(iso){y=+iso[1];m=+iso[2];d=+iso[3];}
 else if(short){d=+short[1];m=+short[2];y=+short[3];if(y<100)y+=2000;}
 else if(named){d=+named[1];m=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(named[2].toLowerCase())+1;y=+named[3];if(y<100)y+=2000;}
 else return '';
 const date=new Date(Date.UTC(y,m-1,d));
 return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?date.toISOString().slice(0,10):'';
}
export function parseTripWorkbook(buffer:ArrayBuffer):ImportRow[] {
 const workbook=XLSX.read(buffer,{type:'array',cellDates:false});
 const name=workbook.SheetNames.find(n=>key(n)==='trips')??workbook.SheetNames[0];
 if(!name)throw new Error('Workbook has no worksheet.');
 const matrix=XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name],{header:1,defval:'',raw:true});
 const indexes=new Map<string,number[]>();
 (matrix[0]??[]).forEach((h,i)=>indexes.set(key(h),[...(indexes.get(key(h))??[]),i]));
 const required=['date','truck type','company name','driver name','owner','plate #','from','to','paper received by'];
 const missing=required.filter(h=>!indexes.has(h));if(missing.length)throw new Error('Missing BuKu columns: '+missing.join(', '));
 const rows:ImportRow[]=[];
 for(let i=1;i<matrix.length;i++) {
  const source=matrix[i];const get=(h:string,n=0)=>source[indexes.get(key(h))?.[n]]??'';
  const plateIndex=indexes.get('plate #')?.[0];const plate=plateIndex===undefined?'':workbook.Sheets[name][XLSX.utils.encode_cell({r:i,c:plateIndex})];
  const first=(...headers:string[])=>{for(const h of headers){const v=get(h);if(text(v)!=='')return v;}return '';};
  // Formula-only footer/template rows are not Trips. Preserve actual source row numbers.
  if(!['DATE','COMPANY NAME','TRUCK TYPE','PLATE #','DRIVER NAME','FROM','TO','PO/DO/JOB NO.'].some(h=>text(get(h))))continue;
  const paper=text(get('PAPER RECEIVED BY')),ppr=!paper||/pending/i.test(paper)?'pending':/not[_ ]required|n\/a/i.test(paper)?'not_required':'received';
  const invoice=text(first('INVOICE NUMBER','INVOICED'));
  rows.push({rowNo:i+1,trip_date:importDate(get('DATE')),customer:text(get('COMPANY NAME')),truck_type:text(get('TRUCK TYPE')),
   vehicle:text(plate?.w??get('PLATE #')),driver:text(get('DRIVER NAME')),owner_supplier:text(get('OWNER')),po_do_job_no:text(get('PO/DO/JOB NO.')),
   from_location:text(get('FROM')),to_location:text(get('TO')),ppr_status:ppr,ppr_employee:ppr==='received'?paper:'',ppr_date:ppr==='received'?importDate(get('DATE',1)):'',
   customer_rate:text(first('Customer Rate','rate with company')),supplier_rent:text(first('Supplier Rent','RENT WITH DRIVER')),
   driver_pay:text(get('Driver Pay')),sale_type:text(first('Sale Type (Cash / Credit)','Sale Type ( Cash / Credit)')).toLowerCase(),
   source_invoice_no:/^(yes|no|y|n|true|false|invoiced|pending)$/i.test(invoice)?'':invoice,notes:text(get('Notes')),errors:[]});
 }
 if(!rows.length)throw new Error('No Trip rows found.');
 if(rows.length>20000)throw new Error('Upload at most 20,000 Trips per file.');
 return rows;
}

export type ImportBatch={requestId:string;rows:Record<string,unknown>[];rowNos:number[]};
export type ImportJob={id:string;scope:string;fileName:string;sourceHash?:string;serverId?:string;batches:ImportBatch[];completed:number;total:number};
export function makeImportJob(scope:string,fileName:string,rows:ImportRow[]):ImportJob {
 const valid=rows.filter(r=>!r.errors.length);const batches:ImportBatch[]=[];
 for(let i=0;i<valid.length;i+=100){const batch=valid.slice(i,i+100);batches.push({requestId:crypto.randomUUID(),rows:batch.map(r=>r.payload!),rowNos:batch.map(r=>r.rowNo)});}
 return {id:crypto.randomUUID(),scope,fileName,batches,completed:0,total:valid.length};
}
// Save before sending any batch; a lost response reuses the SAME server request ID.
export async function runImportJob(job:ImportJob,send:(batch:ImportBatch)=>Promise<unknown>,save:(job:ImportJob)=>Promise<void>,progress:(job:ImportJob)=>void,stop:()=>boolean) {
 await save(job);
 while(job.completed<job.batches.length&&!stop()) {
  const batch=job.batches[job.completed];const result=await send(batch);
  if(!Array.isArray(result)||result.length!==batch.rows.length)throw new Error('Unexpected import response. Resume to reconcile this batch safely.');
  const next={...job,completed:job.completed+1};
  await save(next);job.completed=next.completed;progress(job);
 }
}
async function database():Promise<IDBDatabase> {
 return new Promise((resolve,reject)=>{const r=indexedDB.open('navilo-transport-import',2);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('jobs'))r.result.createObjectStore('jobs',{keyPath:'scope'});if(!r.result.objectStoreNames.contains('progress'))r.result.createObjectStore('progress',{keyPath:'scope'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
}
export async function storedImport(scope:string):Promise<ImportJob|null> {
 const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(['jobs','progress'],'readonly'),r=tx.objectStore('jobs').get(scope),p=tx.objectStore('progress').get(scope);tx.oncomplete=()=>{db.close();const job=r.result;resolve(job?{...job,completed:p.result?.id===job.id?p.result.completed:job.completed}:null);};tx.onerror=()=>{db.close();reject(tx.error);};});
}
export async function saveImport(job:ImportJob):Promise<void> {
 const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(['jobs','progress'],'readwrite'),store=tx.objectStore('jobs'),existing=store.get(job.scope);
  existing.onsuccess=()=>{if(existing.result?.id!==job.id)store.put(job);tx.objectStore('progress').put({scope:job.scope,id:job.id,completed:job.completed});};
  tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};tx.onabort=()=>{db.close();reject(tx.error);};});
}

export async function fileDigest(buffer:ArrayBuffer):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),n=>n.toString(16).padStart(2,'0')).join('');}

export async function parseTripFile(buffer:ArrayBuffer):Promise<ImportRow[]> {
 if(typeof Worker==='undefined')return parseTripWorkbook(buffer);
 const worker=new Worker(new URL('./transportTripImport.worker.ts',import.meta.url),{type:'module'});
 return new Promise((resolve,reject)=>{worker.onmessage=event=>{worker.terminate();if(event.data.error)reject(new Error(event.data.error));else resolve(event.data.rows);};worker.onerror=()=>{worker.terminate();reject(new Error('Unable to read workbook. Try a smaller file or CSV.'));};worker.postMessage(buffer,[buffer]);});
}
