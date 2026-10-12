import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {formatNaviloDate} from '@/lib/naviloDate';
import {transportWorkDesks,type TransportWorkDesk} from './transportWorkDesks';
import {readWorkQueueCache,writeWorkQueueCache,workQueueCacheKey} from './transportWorkQueueCache';

type QueueDesk=Exclude<TransportWorkDesk,'all'>;
type QueueRow={
  id:string;trip_no:string;trip_date:string;job_no:string|null;
  customer:string;driver:string;vehicle:string;truck_type:string|null;
  from:string|null;to:string|null;ppr_status:string|null;
  ppr_received_date:string|null;ppr_received_by:string|null;
  customer_rate_status:string|null;supplier_rent_status:string|null;trip_status:string|null;
};
const explanations:Record<QueueDesk,string>={
  operations:'Recent trips for daily dispatch and assignment. Select a Trip to edit it in the full Register.',
  billing:'Customer rate preparation queue. Pending rate does not necessarily mean unbilled; confirm invoice status in the Register.',
  supplier:'Supplier rate preparation queue. Pending rate does not establish an unpaid supplier balance.',
  payments:'Recent trips for payment review. Outstanding amounts and allocation must be checked in the canonical Cash Counter.',
  ppr:'Trips with papers not marked Received. Select a Trip to record PPR in the existing Register.',
};
const titles:Record<QueueDesk,string>={
  operations:'Trip Operations',billing:'Customer Billing',supplier:'Supplier Desk',
  payments:'Payments Desk',ppr:'PPR & Papers'
};

export default function TransportWorkQueue({
  desk,scopeKey,onDeskChange,onOpenTrip,onCashCounter
}:{
  desk:QueueDesk;scopeKey:string;onDeskChange:(desk:TransportWorkDesk)=>void;
  onOpenTrip:(tripNo:string)=>void;onCashCounter:(side:'customer'|'supplier')=>void;
}){
  const [draft,setDraft]=useState('');
  const [search,setSearch]=useState('');
  const [page,setPage]=useState(0);
  const [rows,setRows]=useState<QueueRow[]>([]);
  const [hasLoaded,setHasLoaded]=useState(false);
  const [hasMore,setHasMore]=useState(false);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [refresh,setRefresh]=useState(0);
  const shownKey=useRef<string|null>(null);

  useEffect(()=>{
    const controller=new AbortController();
    const key=workQueueCacheKey(scopeKey,desk,page,search);
    // A short-lived, user-scoped snapshot makes revisiting a desk immediate.
    // Manual Refresh bypasses the snapshot. Never display another scope's rows.
    const cached=readWorkQueueCache<QueueRow>(key);
    const keepVisible=shownKey.current===key;
    if(cached){
      setRows(cached.rows);setHasMore(cached.hasMore);setHasLoaded(true);shownKey.current=key;
      setLoading(false);setError('');
    }else if(!keepVisible){
      shownKey.current=null;setHasLoaded(false);setRows([]);setHasMore(false);
    }
    setLoading(true);setError('');
    void (async()=>{
      try{
        const {data,error:rpcError}=await supabase.rpc('transport_work_queue',{
          p_desk:desk,p_page:page,p_search:search
        }).abortSignal(controller.signal);
        if(controller.signal.aborted)return;
        if(rpcError)throw rpcError;
        const nextRows:QueueRow[]=Array.isArray(data?.rows)?data.rows:[];
        const more=data?.has_more===true;
        setRows(nextRows);setHasMore(more);setHasLoaded(true);shownKey.current=key;
        writeWorkQueueCache(key,nextRows,more);
      }catch(e:any){
        if(!controller.signal.aborted){setError(e?.message||'Unable to load working queue');if(!cached&&!keepVisible)setHasMore(false);setHasLoaded(true);}
      }finally{if(!controller.signal.aborted)setLoading(false);}
    })();
    return ()=>controller.abort();
  },[desk,scopeKey,page,search,refresh]);

  return <section data-testid="transport-work-queue" className="flex min-h-[360px] h-[calc(100dvh-100px)] flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
    <header className="flex shrink-0 flex-wrap items-center gap-2 bg-slate-950 px-3 py-2 text-white">
      <span className="text-[13px] font-extrabold">Transport</span>
      <label className="sr-only" htmlFor="transport-work-queue-desk">Working desk</label>
      <select id="transport-work-queue-desk" aria-label="Transport working desk" className="h-8 rounded border border-slate-500 bg-slate-800 px-2 text-xs font-bold"
        value={desk} onChange={e=>onDeskChange(e.target.value as TransportWorkDesk)}>
        {transportWorkDesks.map(option=><option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
      <form className="flex h-8 min-w-[190px] flex-1 items-center gap-1" onSubmit={e=>{e.preventDefault();setPage(0);setSearch(draft.trim());}}>
        <input aria-label="Find Trip or Job prefix" className="h-8 w-full max-w-[290px] rounded border border-slate-500 bg-white px-2 text-xs text-slate-900"
          maxLength={80} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Trip / Job starts with…"/>
        <button type="submit" className="h-8 rounded bg-blue-600 px-3 text-[11px] font-semibold hover:bg-blue-700">Search</button>
      </form>
      <button type="button" className="h-8 rounded border border-slate-500 px-3 text-[11px] hover:bg-slate-800" onClick={()=>setRefresh(x=>x+1)}>Refresh</button>
      <button type="button" className="h-8 rounded border border-slate-500 px-3 text-[11px] hover:bg-slate-800" onClick={()=>onDeskChange('all')}>Full Register</button>
    </header>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
      <div><strong className="text-xs text-slate-900">{titles[desk]}</strong><p className="text-[11px] text-slate-600">{explanations[desk]}</p></div>
      {desk==='payments'&&<div className="flex gap-2">
        <button type="button" onClick={()=>onCashCounter('customer')} className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-800">Receive Customer Payment</button>
        <button type="button" onClick={()=>onCashCounter('supplier')} className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800">Pay Supplier Rent</button>
      </div>}
    </div>
    {error&&<div role="alert" className="m-3 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">{error} <button type="button" className="ml-2 font-bold underline" onClick={()=>setRefresh(x=>x+1)}>Retry</button></div>}
    {loading&&!hasLoaded&&<p role="status" className="px-3 py-2 text-xs text-blue-700">Loading {titles[desk]} (50 trips per page)…</p>}
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full min-w-[900px] border-collapse text-[11px]">
        <thead className="sticky top-0 bg-slate-100 text-left text-slate-800">
          <tr>{['Trip No','Date','Customer','Job No','From','To','Vehicle','Driver',desk==='ppr'?'PPR':desk==='billing'?'Customer Rate':desk==='supplier'?'Supplier Rent':'Status','Action'].map(label=><th key={label} className="border-b border-r border-slate-200 px-2 py-2">{label}</th>)}</tr>
        </thead>
        <tbody>{rows.map(r=><tr key={r.id} className="border-b border-slate-100 hover:bg-blue-50">
          <td className="px-2 py-1.5 font-bold text-blue-700">{r.trip_no}</td>
          <td className="px-2 py-1.5 whitespace-nowrap">{formatNaviloDate(r.trip_date)}</td>
          <td className="px-2 py-1.5">{r.customer||'—'}</td>
          <td className="px-2 py-1.5">{r.job_no||'—'}</td>
          <td className="px-2 py-1.5">{r.from||'—'}</td>
          <td className="px-2 py-1.5">{r.to||'—'}</td>
          <td className="px-2 py-1.5">{r.vehicle||'—'}</td>
          <td className="px-2 py-1.5">{r.driver||'—'}</td>
          <td className="px-2 py-1.5">{desk==='ppr'?r.ppr_status:desk==='billing'?r.customer_rate_status:desk==='supplier'?r.supplier_rent_status:r.trip_status||'—'}</td>
          <td className="px-2 py-1.5"><button type="button" onClick={()=>onOpenTrip(r.trip_no)} className="rounded border border-blue-200 bg-blue-50 px-2 py-1 font-bold text-blue-700 hover:bg-blue-100">Open Trip</button></td>
        </tr>)}
          {!loading&&!error&&rows.length===0&&<tr><td colSpan={10} className="p-6 text-center text-slate-500">No matching trips in this working queue.</td></tr>}
        </tbody>
      </table>
    </div>
    <footer className="flex shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
      <span>{rows.length} shown · Page {page+1} · No historical total-count scan{loading&&hasLoaded?' · Updating…':''}</span>
      <div className="flex gap-2">
        <button type="button" disabled={loading||page===0} onClick={()=>setPage(x=>Math.max(0,x-1))} className="rounded border bg-white px-3 py-1 disabled:opacity-40">Previous</button>
        <button type="button" disabled={loading||!hasMore} onClick={()=>setPage(x=>x+1)} className="rounded border bg-white px-3 py-1 disabled:opacity-40">Next</button>
      </div>
    </footer>
  </section>;
}
