import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useAuth} from '@/auth/AuthContext';
import TransportPagination from './TransportPagination';
type Audit={trip_no?:string;id:number;trip_id:string;event_type:string;old_data:Record<string,unknown>|null;new_data:Record<string,unknown>|null;changed_by:string;changed_at:string};
const display=(v:unknown)=>v==null?'—':typeof v==='object'?JSON.stringify(v):String(v);
export default function TransportAudit({trips}:{trips:Array<{id:string;trip_no:string}>}){
 const {activeCompany,activeBusinessUnit}=useAuth();const company=activeCompany?.company_id;const unit=activeBusinessUnit?.business_unit_id;
 const [rows,setRows]=useState<Audit[]>([]);const [search,setSearch]=useState('');const [error,setError]=useState('');
 const [page,setPage]=useState(0),[count,setCount]=useState(0),[busy,setBusy]=useState(false);
 useEffect(()=>{setPage(0);},[company,unit,search]);
 useEffect(()=>{let live=true;setBusy(true);setRows([]);const timer=window.setTimeout(()=>{if(company&&unit)void (async()=>{
  try{const r=await supabase.rpc('transport_audit_page',{p_limit:500,p_offset:page*500,p_search:search});if(!live)return;if(r.error)throw r.error;setRows(r.data.rows);setCount(r.data.count);setError('');}catch(e:any){if(live)setError(e.message);}finally{if(live)setBusy(false);}
 })();},200);return()=>{live=false;window.clearTimeout(timer)};},[company,unit,search,page]);
 const tripName=(id:string)=>rows.find(r=>r.trip_id===id)?.trip_no??trips.find(t=>t.id===id)?.trip_no??id;
 return <div className="rounded-lg border bg-white p-4"><h2 className="font-semibold">Trip Audit</h2><label>Search history <input className="input my-3" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Trip, event, user or reason"/></label>{error&&<p role="alert">{error}</p>}
 {rows.map(r=><details key={r.id} className="border-t py-2 text-xs"><summary>{tripName(r.trip_id)} · {r.event_type} · {r.changed_at} · {r.changed_by}</summary><table className="mt-2 w-full"><thead><tr><th className="text-left">Field</th><th className="text-left">Before</th><th className="text-left">After</th></tr></thead><tbody>{[...new Set([...Object.keys(r.old_data??{}),...Object.keys(r.new_data??{})])].filter(k=>display(r.old_data?.[k])!==display(r.new_data?.[k])).map(k=><tr key={k}><td className="pr-2 align-top">{k.replaceAll('_',' ')}</td><td className="max-w-sm break-words pr-2 align-top">{display(r.old_data?.[k])}</td><td className="max-w-sm break-words align-top">{display(r.new_data?.[k])}</td></tr>)}</tbody></table></details>)}<TransportPagination page={page} pageSize={500} count={count} busy={busy} onPage={setPage}/>{!busy&&!rows.length&&!error&&<p className="text-sm text-slate-500">No recorded changes in this workspace.</p>}</div>
}
