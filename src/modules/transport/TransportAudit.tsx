import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useAuth} from '@/auth/AuthContext';
import {formatNaviloDate} from '@/lib/naviloDate';
import TransportPagination from './TransportPagination';
type Audit={id:number;event_type:string;old_data:Record<string,unknown>|null;new_data:Record<string,unknown>|null;actor_name:string;event_at:string|null;event_reason:string|null;source:string};
type Report={trip_no:string;rows:Audit[];count:number;labels:Record<string,string>;snapshot:Record<string,unknown>;deleted:boolean};
const label=(s:string)=>s.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const value=(v:unknown,labels:Record<string,string>):string=>v==null?'—':typeof v==='object'?JSON.stringify(v):labels[String(v)]??String(v);
const eventTime=(timestamp:string)=>{
 const date=new Date(timestamp);
 const day=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
 return `${formatNaviloDate(day)} ${date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;
};
const eventTitle=(s:string)=>({insert:'Trip created',update:'Trip updated',delete:'Trip deleted',status_changed:'Status changed',customer_bill_posted:'Customer invoice posted',supplier_bill_posted:'Supplier invoice posted'}[s]??label(s));
export default function TransportAudit(_props:{trips?:Array<{id:string;trip_no:string}>}){
 const {activeCompany,activeBusinessUnit}=useAuth();const scope=`${activeCompany?.company_id}/${activeBusinessUnit?.business_unit_id}`;
 const [input,setInput]=useState(''),[submitted,setSubmitted]=useState(''),[report,setReport]=useState<Report|null>(null),[page,setPage]=useState(0),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0),[error,setError]=useState('');const generation=useRef(0);
 useEffect(()=>{setInput('');setSubmitted('');setReport(null);setPage(0);setError('');setBusy(false);generation.current++;},[scope]);
 useEffect(()=>{
  if(!submitted)return;const request=++generation.current;let live=true;setBusy(true);setError('');setReport(null);
  void (async()=>{try{const r=await supabase.rpc('transport_trip_audit_report',{p_trip_no:submitted,p_limit:500,p_offset:page*500});if(!live||request!==generation.current)return;if(r.error)throw r.error;setReport(r.data);}catch(e){if(live&&request===generation.current)setError(e&&typeof e==='object'&&'message' in e?String(e.message):'Unable to generate Trip audit');}finally{if(live&&request===generation.current)setBusy(false)}})();
  return()=>{live=false};
 },[submitted,page,scope,refresh]);
 return <section className="rounded-lg border bg-white p-3 text-xs"><h2 className="text-sm font-semibold">Trip Audit Report</h2><p className="mt-1 text-slate-500">Enter an exact Trip No to see its recorded changes, posting actions and timeline in the active Business Unit.</p>
 <form className="my-3 flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();const n=input.trim().toUpperCase();if(!n){setError('Enter a Trip No');return;}setPage(0);setReport(null);setSubmitted(n);setRefresh(v=>v+1);generation.current++;}}><label className="space-y-1">Trip No<input aria-label="Audit Trip No" className="input block" maxLength={120} placeholder="e.g. TRP-0000001" value={input} onChange={e=>setInput(e.target.value)}/></label><button className="btn-primary" disabled={busy||!input.trim()}>Generate audit report</button></form>
 {error&&<p role="alert" className="mb-2 text-red-700">{error}</p>}{busy&&<p role="status">Generating Trip audit…</p>}
 {!submitted&&!error&&<p className="rounded border border-dashed p-4 text-slate-500">No audit is loaded until you enter a Trip No.</p>}
 {report&&<><div className="mb-3 rounded border bg-slate-50 p-2"><div className="flex flex-wrap gap-3 font-semibold"><span>{report.trip_no}</span><span>{report.count.toLocaleString()} recorded events</span>{report.deleted&&<span className="text-red-700">Trip deleted · history retained</span>}</div>
 <dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{['trip_date','status','job_status','customer_id','vehicle_id','driver_id','from_location_id','to_location_id'].filter(k=>report.snapshot[k]!=null).map(k=><div key={k}><dt className="text-slate-500">{label(k)}</dt><dd>{k==='trip_date'?formatNaviloDate(String(report.snapshot[k])):value(report.snapshot[k],report.labels)}</dd></div>)}</dl></div>
 {!report.count&&<p>No recorded audit for this exact Trip No in the active Business Unit.</p>}
 <ol className="space-y-2 border-l-2 border-slate-200 pl-3">{report.rows.map(r=><li key={r.id} className="rounded border p-2"><div className="flex flex-wrap justify-between gap-2"><strong>{eventTitle(r.event_type)}</strong><time>{r.event_at?eventTime(r.event_at):'Time not recorded'}</time></div><p className="mt-1 text-slate-600">By: {r.actor_name} · Source: {r.source}</p>{r.event_reason&&<p className="mt-1">Reason: {r.event_reason}</p>}
 <details className="mt-2" open={report.rows.length<=10}><summary className="cursor-pointer font-semibold">Recorded field changes</summary><div className="overflow-x-auto"><table className="mt-1 w-full text-left"><thead><tr><th className="pr-2">Field</th><th className="pr-2">Before</th><th>After</th></tr></thead><tbody>{[...new Set([...Object.keys(r.old_data??{}),...Object.keys(r.new_data??{})])].filter(k=>JSON.stringify(r.old_data?.[k])!==JSON.stringify(r.new_data?.[k])).map(k=><tr key={k} className="border-t"><td className="py-1 pr-2 align-top">{label(k)}</td><td className="max-w-sm break-words pr-2 align-top">{value(r.old_data?.[k],report.labels)}</td><td className="max-w-sm break-words align-top">{value(r.new_data?.[k],report.labels)}</td></tr>)}</tbody></table></div></details></li>)}</ol>
 <TransportPagination page={page} pageSize={500} count={report.count} busy={busy} onPage={setPage}/><p className="mt-2 text-slate-500">Timeline: oldest to newest. Only recorded evidence is shown; missing historical source/location details are not inferred.</p></>}
 </section>;
}
