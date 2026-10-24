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
interface DeletedJournal {event_id:string;entry_no:string;entry_date:string;deleted_at:string;reason:string;performed_by:string;lines:Array<{id:string;account:string;debit:number;credit:number;description?:string}>;entry_snapshot:Record<string,unknown>;}\ninterface AuditLog { id:string; action:string; module:string|null; table_name?:string|null; record_id?:string|null; record_name:string|null; performed_by:string|null; performed_email?:string|null; old_data?:Json; new_data?:Json; metadata?:Json; created_at:string; }
const text=(v:unknown)=>v===null||v===undefined||v===""?"—":typeof v==="object"?JSON.stringify(v):String(v);
const PAGE_SIZE=40;
const riyadhStart=(day:string)=>new Date(day+"T00:00:00+03:00").toISOString();
const riyadhNext=(day:string)=>new Date(new Date(day+"T00:00:00+03:00").getTime()+86400000).toISOString();
const safeSearch=(value:string)=>value.replace(/[%,().]/g," ").trim();
const changedKeys=(log:AuditLog)=>Array.from(new Set([...Object.keys(log.old_data??{}),...Object.keys(log.new_data??{})])).filter(k=>JSON.stringify(log.old_data?.[k])!==JSON.stringify(log.new_data?.[k]));

export default function AuditTrail(){
 const[details,setDetails]=useState<Record<string,AuditLog>>({}),[logs,setLogs]=useState<AuditLog[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[query,setQuery]=useState(""),[action,setAction]=useState("all"),[module,setModule]=useState("all"),[from,setFrom]=useState(""),[to,setTo]=useState(""),[open,setOpen]=useState<string|null>(null),[page,setPage]=useState(0),[hasMore,setHasMore]=useState(false),[refresh,setRefresh]=useState(0);
 const[view,setView]=useState<"activity"|"deleted">("activity");
 const[deleted,setDeleted]=useState<DeletedJournal[]>([]);
 const[deletedLoading,setDeletedLoading]=useState(false);
 const[deletedError,setDeletedError]=useState<string|null>(null);
 const[deletedOpen,setDeletedOpen]=useState<string|null>(null);
 const[deletedQuery,setDeletedQuery]=useState("");
 const fetchDeleted=useCallback(async()=>{
  setDeletedLoading(true);setDeletedError(null);
  const {data,error}=await supabase.rpc("owner_deleted_journal_history",{p_limit:500});
  if(error){setDeletedError(error.message);setDeleted([]);}
  else setDeleted((data||[]) as DeletedJournal[]);
  setDeletedLoading(false);
 },[]);
 useEffect(()=>{if(view==="deleted")void fetchDeleted();},[view,fetchDeleted,refresh]);
 const printRoot=useRef<HTMLDivElement|null>(null);
 const search=query.trim();
 const scopedRequest=useCallback(()=>{
   let request=supabase.from("audit_logs").select("id,action,module,table_name,record_id,record_name,performed_by,performed_email,created_at");
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
   if(from&&to&&from>to){setError("From date must be on or before To date.");setLogs([]);setHasMore(false);setLoading(false);return;}
   setLoading(true);setError(null);
   const {data,error}=await scopedRequest().order("created_at",{ascending:false}).range(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
   if(error){setError(error.message);setLogs([]);setHasMore(false);}else{setLogs(((data??[]).slice(0,PAGE_SIZE)) as AuditLog[]);setHasMore((data??[]).length>PAGE_SIZE);}
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
 const detailFor=(log:AuditLog)=>details[log.id]??log;
 const toggleDetails=async(log:AuditLog)=>{if(open===log.id){setOpen(null);return;}setOpen(log.id);if(details[log.id])return;const {data,error}=await supabase.from("audit_logs").select("id,old_data,new_data,metadata").eq("id",log.id).maybeSingle();if(error){setError(error.message);return;}if(data)setDetails(prev=>({...prev,[log.id]:{...log,...data}}));};
 const colors:Record<string,string>={INSERT:"bg-emerald-100 text-emerald-800",UPDATE:"bg-blue-100 text-blue-800",DELETE:"bg-rose-100 text-rose-800",RESET:"bg-rose-100 text-rose-800"};
 return <div ref={printRoot} className="w-full space-y-3 pb-6">
  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"><div><h1 className="flex items-center gap-2 text-lg font-bold text-slate-900"><Shield className="h-6 w-6 text-indigo-600"/>Audit Trail & Activity History</h1><p className="mt-1 text-sm text-slate-500">Complete user activity with record reference, before/after values and searchable history.</p></div><button onClick={()=>setRefresh(x=>x+1)} className="btn-secondary"><RefreshCw className="h-4 w-4"/>Refresh Logs</button></div>
  <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
   <button className={`rounded-md px-3 py-2 text-sm font-semibold ${view==="activity"?"bg-slate-900 text-white":"bg-white border text-slate-700"}`} onClick={()=>setView("activity")}>Activity History</button>
   <button className={`rounded-md px-3 py-2 text-sm font-semibold ${view==="deleted"?"bg-slate-900 text-white":"bg-white border text-slate-700"}`} onClick={()=>setView("deleted")}>Deleted Journals</button>
  </div>
  {view==="deleted" && <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap justify-between items-center gap-2 p-3 border-b">
      <div><h2 className="font-semibold text-slate-900">Deleted Journal Archive</h2><p className="text-xs text-slate-500">Read-only original records. No reversal or automatic restore.</p></div>
      <div className="flex gap-2"><input className="input text-sm" placeholder="Search JE number or reason" value={deletedQuery} onChange={e=>setDeletedQuery(e.target.value)}/><button className="btn-secondary" onClick={()=>void fetchDeleted()}>Refresh</button></div>
    </div>
    {deletedError&&<div className="p-3"><ErrorBanner message={deletedError}/></div>}
    {deletedLoading?<p className="p-4 text-sm text-slate-500">Loading deleted journals…</p>:
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="text-left p-2">Journal</th><th className="text-left p-2">Entry Date</th><th className="text-right p-2">Debit</th><th className="text-right p-2">Credit</th><th className="text-left p-2">Deleted At</th><th className="text-left p-2">Reason</th><th className="text-right p-2">Action</th></tr></thead><tbody>
      {deleted.filter(d=>[d.entry_no,d.reason].some(v=>(v||"").toLowerCase().includes(deletedQuery.toLowerCase()))).map(d=><tr key={d.event_id} className="border-t align-top">
        <td className="p-2 font-semibold">{d.entry_no}</td><td className="p-2">{d.entry_date?formatNaviloDate(d.entry_date):"—"}</td>
        <td className="p-2 text-right tabular-nums">{(d.lines||[]).reduce((v,l)=>v+Number(l.debit||0),0).toLocaleString(undefined,{minimumFractionDigits:2})}</td>
        <td className="p-2 text-right tabular-nums">{(d.lines||[]).reduce((v,l)=>v+Number(l.credit||0),0).toLocaleString(undefined,{minimumFractionDigits:2})}</td>
        <td className="p-2 whitespace-nowrap">{new Date(d.deleted_at).toLocaleString()}</td><td className="p-2 max-w-[230px] break-words">{d.reason||"—"}</td>
        <td className="p-2 text-right"><button className="rounded border px-2 py-1 text-xs font-semibold" onClick={()=>setDeletedOpen(deletedOpen===d.event_id?null:d.event_id)}>{deletedOpen===d.event_id?"Close":"View Original"}</button>
          {deletedOpen===d.event_id&&<div className="mt-2 rounded border bg-slate-50 p-2 text-left min-w-[330px]"><p className="text-xs font-semibold mb-2">Original journal lines</p><table className="w-full text-xs"><thead><tr><th className="text-left">Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead><tbody>{(d.lines||[]).map(l=><tr key={l.id} className="border-t"><td className="py-1">{l.account}<div className="text-slate-500">{l.description||""}</div></td><td className="text-right">{Number(l.debit||0).toFixed(2)}</td><td className="text-right">{Number(l.credit||0).toFixed(2)}</td></tr>)}</tbody></table><p className="mt-2 text-xs text-slate-500">Deleted by: {d.performed_by}</p></div>}
        </td>
      </tr>)}</tbody></table>{deleted.length===0&&<p className="p-4 text-sm text-slate-500">No deleted journal records available for this workspace.</p>}</div>}
  </section>}
  {view==="activity" && <>
  {error&&<ErrorBanner message={error}/>}<div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6"><label className="relative xl:col-span-2"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"/><input className="input w-full pl-9" placeholder="Search user, invoice, order, party, record ID..." value={query} onChange={e=>setQuery(e.target.value)}/></label><SearchableSelect className="input" value={action} onChange={e=>setAction(e.target.value)}><option value="all">All actions</option>{actions.map(x=><option key={x}>{x}</option>)}</SearchableSelect><SearchableSelect className="input" value={module} onChange={e=>setModule(e.target.value)}><option value="all">All modules</option>{modules.map(x=><option key={x}>{x}</option>)}</SearchableSelect><NaviloDateInput className="input" type="date" value={from} onChange={e=>setFrom(e.target.value)}/><NaviloDateInput className="input" type="date" value={to} onChange={e=>setTo(e.target.value)}/></div><div className="mt-3 text-xs text-slate-500">Showing <b>{filtered.length}</b> on this page · Page {page+1} · Search is database-wide for record names, users, modules and IDs. Audit history is read-only.</div></div>
  <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><DataTable<AuditLog> columns={[
 {key:"expand",label:"Details",sortable:false,filterable:false,render:log=><button className="rounded p-1 hover:bg-slate-200" onClick={()=>void toggleDetails(log)}>{open===log.id?<ChevronDown className="h-4 w-4"/>:<ChevronRight className="h-4 w-4"/>}</button>},
 {key:"action",label:"Action",render:log=><span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ${colors[log.action]||"bg-slate-100 text-slate-700"}`}>{log.action}</span>},
 {key:"module",label:"Module / Table",render:log=><><div>{log.module||"—"}</div><div className="text-xs text-slate-400">{log.table_name||""}</div></>,getFilterValue:log=>`${log.module||""} ${log.table_name||""}`},
 {key:"record",label:"Record / Reference",render:log=><><div>{log.record_name||"—"}</div><div className="font-mono text-xs text-slate-400">{log.record_id||""}</div>{open===log.id&&<div className="mt-2 max-w-xl space-y-2 rounded border bg-slate-50 p-3 text-xs"><div><b>Record ID:</b> {text(log.record_id)} · <b>User:</b> {text(log.performed_by)}</div>{details[log.id]?.metadata&&<pre className="max-h-32 overflow-auto whitespace-pre-wrap">{JSON.stringify(details[log.id]?.metadata,null,2)}</pre>}<b>Changed values</b>{details[log.id]&&changedKeys(detailFor(log)).length?<div className="space-y-1">{changedKeys(detailFor(log)).map(k=><div key={k} className="border-t py-1"><b>{k}</b>: {text(detailFor(log).old_data?.[k])} → {text(detailFor(log).new_data?.[k])}</div>)}</div>:<div>{details[log.id]?"No before/after field values were stored.":"Loading change details…"}</div>}</div>}</>,getFilterValue:log=>`${log.record_name||""} ${log.record_id||""}`},
 {key:"performed_by",label:"Performed By",render:log=><>{log.performed_by||"—"}<div className="text-xs text-slate-400">{log.performed_email||""}</div></>},
 {key:"created_at",label:"Date & Time",render:log=>new Date(log.created_at).toLocaleString()}
 ]} rows={filtered} loading={loading} emptyMessage={error?"Unable to load audit records.":logs.length===0?"No matching audit records. Clear search or expand the date range.":"No records on this page."}/></div><div className="flex items-center justify-between gap-3 border-t border-slate-200 p-2 text-xs"><span>Page {page+1} · {PAGE_SIZE} per page</span><div className="flex gap-2"><button className="btn" disabled={loading||page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}>Previous</button><button className="btn" disabled={loading||!hasMore} onClick={()=>setPage(p=>p+1)}>Next</button></div></div></div>
 </div>
}
