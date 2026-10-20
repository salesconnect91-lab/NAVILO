import {useState} from 'react';
import {Link} from 'react-router-dom';
import {MAX_BULK_POST,postSelectedInvoices,type BulkPostSummary,type InvoiceSide} from '@/lib/bulkInvoicePosting';

export default function BulkInvoicePostAction({side,ids,companyId,businessUnitId,onFinished,disabled=false}:{
 side:InvoiceSide;ids:string[];companyId?:string;businessUnitId?:string;onFinished:()=>Promise<void>;disabled?:boolean
}){
 const [busy,setBusy]=useState(false);
 const [progress,setProgress]=useState('');
 const [summary,setSummary]=useState<BulkPostSummary|null>(null);
 const label=side==='sales'?'Sales':'Purchase';
 const post=async()=>{
  if(busy||disabled||!ids.length||ids.length>MAX_BULK_POST||!companyId||!businessUnitId)return;
  if(!window.confirm(`Post ${ids.length} selected ${label} draft invoice(s)? Only validated, non-trip invoices will post. This creates journals and is not an undoable edit. Each document is checked individually; incomplete and already posted invoices are skipped.`))return;
  setBusy(true);setSummary(null);setProgress(`Checking 0 / ${ids.length}`);
  try{
   const result=await postSelectedInvoices({side,ids,companyId,businessUnitId,onProgress:(done,total)=>setProgress(`Processed ${done} / ${total}`)});
   setSummary(result);
   await onFinished();
  }catch(e:any){setSummary({posted:0,failed:ids.length,skipped:0,results:ids.map(id=>({id,status:'failed' as const,message:e?.message||'Bulk posting failed.'}))});}
  finally{setBusy(false);setProgress('');}
 };
 return <div className="space-y-2" data-no-print data-no-export>
  <div className="flex flex-wrap items-center gap-2">
   <button type="button" className="btn-primary" aria-label="Bulk Post selected invoices"
    disabled={busy||disabled||ids.length===0||ids.length>MAX_BULK_POST||!companyId||!businessUnitId}
    onClick={()=>void post()}>{busy?'Posting…':`Bulk Post (${ids.length})`}</button>
   {ids.length>MAX_BULK_POST&&<span className="text-xs text-amber-700">Select at most ${MAX_BULK_POST} per batch.</span>}
   {progress&&<span role="status" className="text-xs font-medium">{progress}</span>}
  </div>
  {summary&&<div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs" role="status">
   <strong>Bulk ${label} result: {summary.posted} posted · {summary.skipped} skipped · {summary.failed} failed.</strong>
   {summary.results.some(r=>r.status!=='posted')&&<div className="mt-1 max-h-28 overflow-y-auto">
    {summary.results.filter(r=>r.status!=='posted').map(r=><p key={r.id} className="py-0.5"><Link className="text-blue-700 underline" to={`/${side}/${r.id}`}>Open invoice</Link> — {r.message}</p>)}
   </div>}
  </div>}
 </div>;
}
