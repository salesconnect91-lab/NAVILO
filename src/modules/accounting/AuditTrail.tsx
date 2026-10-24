import DataTable from "@/components/DataTable";
import {registerPrintSource,printTableMarkup} from "@/lib/printDocument";
import {formatNaviloDate} from "@/lib/naviloDate";
import NaviloDateInput from '@/components/NaviloDateInput';
import SearchableSelect from "@/components/SearchableSelect";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { ErrorBanner } from "@/components/ui";
import { ChevronDown, ChevronRight, RefreshCw, Search, Shield } from "lucide-react";

type Json = Record<string, unknown> | null;
interface AuditLog { id:string; action:string; module:string|null; table_name?:string|null; record_id?:string|null; record_name:string|null; performed_by:string|null; performed_email?:string|null; old_data?:Json; new_data?:Json; metadata?:Json; created_at:string; }
const text=(v:unknown)=>v===null||v===undefined||v===""?"—":typeof v==="object"?JSON.stringify(v):String(v);
const PAGE_SIZE=100;
const riyadhStart=(day:string)=>new Date(day+"T00:00:00+03:00").toISOString();
const riyadhNext=(day:string)=>new Date(new Date(day+"T00:00:00+03:00").getTime()+86400000).toISOString();
const safeSearch=(value:string)=>value.replace(/[%,().]/g," ").trim();
const changedKeys=(log:AuditLog)=>Array.from(new Set([...Object.keys(log.old_data??{}),...Object.keys(log.new_data??{})])).filter(k=>JSON.stringify(log.old_data?.[k])!==JSON.stringify(log.new_data?.[k]));

export default function AuditTrail(){
 const[logs,setLogs]=useState<AuditLog[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[query,setQuery]=useState(""),[action,setAction]=useState("all"),[module,setModule]=useState("all"),[from,setFrom]=useState(""),[to,setTo]=useState(""),[open,setOpen]=useState<string|null>(null),[page,setPage]=useState(0),[total,setTotal]=useState(0),[refresh,setRefresh]=useState(0);
 const printRoot=useRef<HTMLDivElement|null>(null);
 const search=query.trim();
 const scopedRequest=useCallback(()=>{
   let request=supabase.from("audit_logs").select("*",{count:"exact"});
   if(from)request=request.gte("created_at",riyadhStart(from));
   if(to)request=request.lt("created_at",riyadhNext(to));
   if(action!=="all")request=request.eq("action",action);
   if(module!=="all")request=request.or(`module.eq.${module},table_name.eq.${module}`);
   if(search){
     const term=safeSearch(search);
     if(term){const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(term);
       request=request.or(`record_name.ilike.%${term}%,performed_by.ilike.%${term}%,performed_email.ilike.%${term}%,module.ilike.%${term}%,table_name.ilike.%${term}%${uuid?",record_id.eq."+term+",id.eq."+term:""}`);
     }
   }
   return request;
 },[from,to,action,module,search]);
 const fetchLogs=useCallback(async()=>{
   if(from&&to&&from>to){setError("From date must be on or before To date.");setLogs([]);setTotal(0);setLoading(false);return;}
   setLoading(true);setError(null);
   const {data,error,count}=await scopedRequest().order("created_at",{ascending:false}).order("id",{ascending:false}).range(page*PAGE_SIZE,(page+1)*PAGE_SIZE-1);
   if(error){setError(error.message);setLogs([]);setTotal(0);}else{setLogs((data??[]) as AuditLog[]);setTotal(count??0);}
   setLoading(false);
 },[scopedRequest,page]);
 useEffect(()=>{void fetchLogs()},[fetchLogs,refresh]);
 useEffect(()=>{setPage(0)},[query,action,module,from,to]);
 useEffect(()=>{const root=printRoot.current;if(!root)return;return registerPrintSource(root,async()=>{
  return printTableMarkup("Audit Trail & Activity History — Current Page",["Date / Time (UTC)","Action","Module","Record","Performed by","Changes"],logs.map(l=>[formatNaviloDate(l.created_at.slice(0,10))+" "+l.created_at.slice(11,19),l.action,l.module||l.table_name||"—",l.record_name||l.record_id||"—",l.performed_email||l.performed_by||"—",changedKeys(l).map(key=>key+": "+text(l.old_data?.[key])+" → "+text(l.new_data?.[key])).join("; ")||text(l.metadata)]),"Current page only, filtered by the selected dates, action, module and search.");
 });},[logs]);
 const modules=useMemo(()=>Array.from(new Set(logs.map(x=>x.module||x.table_name).filter(Boolean) as string[])).sort(),[logs]);
 const actions=useMemo(()=>Array.from(new Set(logs.map(x=>x.action).filter(Boolean))).sort(),[logs]);
 const filtered=logs;
 const colors:Record<string,string>={INSERT:"bg-emerald-100 text-emerald-800",UPDATE:"bg-blue-100 text-blue-800",DELETE:"bg-rose-100 text-rose-800",RESET:"bg-rose-100 text-rose-800"};
 return <div ref={printRoot} className="w-full space-y-3 pb-6">
  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"><div><h1 className="flex items-center gap-2 text-lg font-bold text-slate-900"><Shield className="h-6 w-6 text-indigo-600"/>Audit Trail & Activity History</h1><p className="mt-1 text-sm text-slate-500">Complete user activity with record reference, before/after values and searchable history.</p></div><button onClick={()=>setRefresh(x=>x+1)} className="btn-secondary"><RefreshCw className="h-4 w-4"/>Refresh Logs</button></div>
  {error&&<ErrorBanner message={error}/>}<div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6"><label className="relative xl:col-span-2"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"/><input className="input w-full pl-9" placeholder="Search user, invoice, order, party, record ID..." value={query} onChange={e=>setQuery(e.target.value)}/></label><SearchableSelect className="input" value={action} onChange={e=>setAction(e.target.value)}><option value="all">All actions</option>{actions.map(x=><option key={x}>{x}</option>)}</SearchableSelect><SearchableSelect className="input" value={module} onChange={e=>setModule(e.target.value)}><option value="all">All modules</option>{modules.map(x=><option key={x}>{x}</option>)}</SearchableSelect><NaviloDateInput className="input" type="date" value={from} onChange={e=>setFrom(e.target.value)}/><NaviloDateInput className="input" type="date" value={to} onChange={e=>setTo(e.target.value)}/></div><div className="mt-3 text-xs text-slate-500">Showing <b>{filtered.length}</b> of {total.toLocaleString()} matching events · Page {page+1} · Search is database-wide for record names, users, modules and IDs. Audit history is read-only.</div></div>
  <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><DataTable<AuditLog> columns={[
 {key:"expand",label:"Details",sortable:false,filterable:false,render:log=><button className="rounded p-1 hover:bg-slate-200" onClick={()=>setOpen(open===log.id?null:log.id)}>{open===log.id?<ChevronDown className="h-4 w-4"/>:<ChevronRight className="h-4 w-4"/>}</button>},
 {key:"action",label:"Action",render:log=><span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ${colors[log.action]||"bg-slate-100 text-slate-700"}`}>{log.action}</span>},
 {key:"module",label:"Module / Table",render:log=><><div>{log.module||"—"}</div><div className="text-xs text-slate-400">{log.table_name||""}</div></>,getFilterValue:log=>`${log.module||""} ${log.table_name||""}`},
 {key:"record",label:"Record / Reference",render:log=><><div>{log.record_name||"—"}</div><div className="font-mono text-xs text-slate-400">{log.record_id||""}</div>{open===log.id&&<div className="mt-2 max-w-xl space-y-2 rounded border bg-slate-50 p-3 text-xs"><div><b>Record ID:</b> {text(log.record_id)} · <b>User:</b> {text(log.performed_by)}</div>{log.metadata&&<pre className="max-h-32 overflow-auto whitespace-pre-wrap">{JSON.stringify(log.metadata,null,2)}</pre>}<b>Changed values</b>{changedKeys(log).length?<div className="space-y-1">{changedKeys(log).map(k=><div key={k} className="border-t py-1"><b>{k}</b>: {text(log.old_data?.[k])} → {text(log.new_data?.[k])}</div>)}</div>:<div>No before/after field values were stored.</div>}</div>}</>,getFilterValue:log=>`${log.record_name||""} ${log.record_id||""}`},
 {key:"performed_by",label:"Performed By",render:log=><>{log.performed_by||"—"}<div className="text-xs text-slate-400">{log.performed_email||""}</div></>},
 {key:"created_at",label:"Date & Time",render:log=>new Date(log.created_at).toLocaleString()}
 ]} rows={filtered} loading={loading} emptyMessage={error?"Unable to load audit records.":total===0?"No matching audit records. Clear search or expand the date range.":"No records on this page."}/></div><div className="flex items-center justify-between gap-3 border-t border-slate-200 p-2 text-xs"><span>{total.toLocaleString()} matching records · {PAGE_SIZE} per page</span><div className="flex gap-2"><button className="btn" disabled={loading||page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}>Previous</button><button className="btn" disabled={loading||(page+1)*PAGE_SIZE>=total} onClick={()=>setPage(p=>p+1)}>Next</button></div></div></div>
 </div>
}
