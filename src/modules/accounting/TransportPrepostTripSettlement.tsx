import {useCallback,useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {fetchAllPages} from '@/lib/fetchAllPages';
import {financialNumber} from '@/modules/transport/transportFinancialTypes';

type Side='customer'|'supplier';
type TripBalance={side:Side;line_id:string;trip_id:string;trip_no:string;trip_date:string;party_id:string;party_name:string;from_location:string|null;to_location:string|null;rate_amount:number;allocated:number;remaining:number};
type Advance={journal_entry_id:string;entry_no:string;available:number};
type Allocation={id:string;trip_id:string;line_id:string;side:Side;party_id:string;amount:number;reference:string|null;created_at:string};

export default function TransportPrepostTripSettlement({side,party,onChanged}:{side:Side;party:string;onChanged:()=>Promise<void>}){
 const [trips,setTrips]=useState<TripBalance[]>([]),[advances,setAdvances]=useState<Advance[]>([]),[allocations,setAllocations]=useState<Allocation[]>([]);
 const [sources,setSources]=useState<Record<string,string>>({}),[amounts,setAmounts]=useState<Record<string,string>>({}),[reasons,setReasons]=useState<Record<string,string>>({});
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const load=useCallback(async()=>{if(!party){setTrips([]);setAdvances([]);setAllocations([]);return;}setLoading(true);setError('');try{
  const [t,a,x]=await Promise.all([
   fetchAllPages<TripBalance>((start,end)=>supabase.from('transport_prepost_trip_balances').select('*').eq('side',side).eq('party_id',party).order('trip_date').range(start,end)),
   fetchAllPages<Advance>((start,end)=>supabase.from('transport_party_advances').select('journal_entry_id,entry_no,available').eq('side',side).eq('party_id',party).gt('available',0).order('entry_date').range(start,end)),
   fetchAllPages<Allocation>((start,end)=>supabase.from('transport_trip_advance_allocations').select('id,trip_id,line_id,side,party_id,amount,reference,created_at').eq('side',side).eq('party_id',party).order('created_at').range(start,end))
  ]);setTrips(t);setAdvances(a);setAllocations(x);
 }catch(e){setError(e instanceof Error?e.message:'Unable to load finalized Trip balances');setTrips([]);setAdvances([]);setAllocations([])}finally{setLoading(false)}},[side,party]);
 useEffect(()=>{void load();},[load]);
 async function submit(op:'allocate'|'release',row:TripBalance,allocation?:Allocation){setBusy(true);setError('');setMessage('');try{
  const amount=op==='allocate'?Number(amounts[row.line_id]||0):Number(allocation?.amount||0),reason=(reasons[row.line_id]||'').trim();
  if(reason.length<3)throw new Error('Enter a reason (at least 3 characters).');
  const request={p_request_id:crypto.randomUUID(),p_side:side,p_operation:op,p_party_id:party,p_trip_id:row.trip_id,p_line_id:row.line_id,p_source_id:op==='allocate'?sources[row.line_id]:null,p_allocation_id:op==='release'?allocation?.id:null,p_amount:op==='allocate'?amount:null,p_reference:null,p_reason:reason};
  const result=await supabase.rpc('transport_allocate_prepost_trip_advance',request);if(result.error)throw result.error;
  await load();await onChanged();setAmounts(v=>({...v,[row.line_id]:''}));setReasons(v=>({...v,[row.line_id]:''}));setMessage(op==='allocate'?'Advance reserved against finalized Trip. Cash/Bank was not posted again.':'Advance released back to available party balance.');
 }catch(e){setError(e instanceof Error?e.message:'Unable to update Trip advance')}finally{setBusy(false)}}
 if(!party)return null;
 return <section className="my-3 rounded border border-blue-200 bg-blue-50/40 p-3 text-xs" aria-label="Finalized unposted Trip settlements">
  <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">Finalized Trips · Pre-invoice Balance</h3><p className="mt-1 text-slate-600">These are operational balances, not posted invoices or financial statements. Record or receive money in Advances above, then reserve it to a finalized Trip here.</p></div><button type="button" className="btn-secondary" disabled={loading||busy} onClick={()=>void load()}>Refresh finalized Trips</button></div>
  {error&&<p role="alert" className="my-2 text-red-700">{error}</p>}{message&&<p role="status" className="my-2 text-emerald-700">{message}</p>}{loading&&<p role="status">Loading finalized unposted Trip balances…</p>}
  {!loading&&!error&&!trips.length&&<p className="my-2 text-slate-600">No finalized, unposted Trip balance for this party in the active branch.</p>}
  {trips.map(row=>{const held=allocations.filter(x=>x.line_id===row.line_id);return <article key={`${row.side}:${row.line_id}`} className="mt-2 rounded border bg-white p-2">
   <div className="flex flex-wrap justify-between gap-2"><strong>{row.trip_no} · {row.trip_date} · {row.from_location||'—'} → {row.to_location||'—'}</strong><span>Finalized {financialNumber(row.rate_amount)} · reserved {financialNumber(row.allocated)} · open {financialNumber(row.remaining)}</span></div>
   <label className="mt-2 inline-block">Reason<input className="input ml-2 w-64" value={reasons[row.line_id]||''} onChange={e=>setReasons(v=>({...v,[row.line_id]:e.target.value}))}/></label>
   {held.map(item=><div key={item.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2"><span>Reserved advance {financialNumber(item.amount)}{item.reference?` · ${item.reference}`:''}</span><button type="button" className="btn-secondary" disabled={busy} onClick={()=>void submit('release',row,item)}>Release to available advances</button></div>)}
   {row.remaining>0.005&&<div className="mt-2 flex flex-wrap items-end gap-2 border-t pt-2">
    <label>Available advance<select className="input" value={sources[row.line_id]||''} onChange={e=>setSources(v=>({...v,[row.line_id]:e.target.value}))}><option value="">Select voucher</option>{advances.map(a=><option key={a.journal_entry_id} value={a.journal_entry_id}>{a.entry_no} · available {financialNumber(a.available)}</option>)}</select></label>
    <label>Amount<input className="input w-32" type="number" min="0.01" step="0.01" value={amounts[row.line_id]||''} onChange={e=>setAmounts(v=>({...v,[row.line_id]:e.target.value}))}/></label>
    <button type="button" className="btn" disabled={busy||!sources[row.line_id]||!(Number(amounts[row.line_id])>0)||Number(amounts[row.line_id])>row.remaining||reasons[row.line_id]?.trim().length<3} onClick={()=>void submit('allocate',row)}>Reserve advance</button>
   </div>}
  </article>})}
 </section>;
}
