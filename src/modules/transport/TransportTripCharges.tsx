import {useEffect,useMemo,useState} from 'react';
import {supabase} from '@/lib/supabase';

type Line={id?:string;charge_type_id:string;code:string;name:string;amount:string;source_rate_id?:string|null};
type Charge={id:string;code:string;name:string;is_active:boolean};
export default function TransportTripCharges({tripId,onClose,onChanged}:{tripId:string;onClose:()=>void;onChanged:()=>Promise<void>}){
 const [trip,setTrip]=useState<any>(null),[types,setTypes]=useState<Charge[]>([]),[rates,setRates]=useState<any[]>([]),[lines,setLines]=useState<Line[]>([]);
 const [selected,setSelected]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(){
  const tr=await supabase.from('transport_trips').select('id,trip_no,trip_date,company_id,business_unit_id,customer_id,customer_name_snapshot,from_location,to_location,customer_rate,customer_base_rate,customer_manual_adjustment,customer_rate_state,sales_order_id').eq('id',tripId).single();
  if(tr.error)throw tr.error;
  const [ct,cr,ln,posted]=await Promise.all([
   supabase.from('transport_charge_types').select('*').eq('company_id',tr.data.company_id).eq('business_unit_id',tr.data.business_unit_id).eq('is_active',true).order('code'),
   supabase.from('transport_customer_charge_rates').select('*,transport_charge_types!transport_customer_charge_rates_charge_type_id_fkey(code,name)').eq('company_id',tr.data.company_id).eq('business_unit_id',tr.data.business_unit_id).eq('customer_id',tr.data.customer_id).eq('is_active',true),
   supabase.from('transport_trip_customer_charges').select('*').eq('trip_id',tripId).order('sort_order').order('id'),
   supabase.rpc('transport_customer_side_posted',{p_trip_id:tripId})
  ]);for(const r of [ct,cr,ln,posted])if(r.error)throw r.error;
  setTrip({...tr.data,posted:posted.data===true});setTypes(ct.data??[]);setRates(cr.data??[]);
  setLines((ln.data??[]).map((x:any)=>({id:x.id,charge_type_id:x.charge_master_id,code:x.code_snapshot,name:x.name_snapshot,amount:String(x.amount),source_rate_id:x.source_rate_id})));
 }
 useEffect(()=>{void load().catch(e=>setError(e.message))},[tripId]);
 const applicable=(chargeTypeId:string)=>rates.filter(r=>r.charge_type_id===chargeTypeId&&r.effective_from<=trip?.trip_date&&(!r.effective_to||r.effective_to>=trip?.trip_date)).sort((a,b)=>b.effective_from.localeCompare(a.effective_from))[0];
 const chargesTotal=useMemo(()=>lines.reduce((s,l)=>s+(Number(l.amount)||0),0),[lines]);
 const base=Number(trip?.customer_base_rate??(Number(trip?.customer_rate??0)-chargesTotal-Number(trip?.customer_manual_adjustment??0)));
 const final=base+chargesTotal+Number(trip?.customer_manual_adjustment??0);
 function add(){
  const t=types.find(x=>x.id===selected);if(!t)return;const r=applicable(t.id);
  setLines(v=>[...v,{charge_type_id:t.id,code:t.code,name:t.name,amount:r?.status==='agreed'&&r.amount!=null?String(r.amount):'',source_rate_id:r?.id??null}]);setSelected('');
 }
 async function save(){
  if(!trip||trip.posted||lines.some(l=>l.amount===''||!Number.isFinite(Number(l.amount))||Number(l.amount)<0)||(trip.customer_rate_state==='finalized'&&!reason.trim()))return;
  setBusy(true);setError('');
  try{const r=await supabase.rpc('transport_replace_trip_customer_charges',{p_trip_id:tripId,p_lines:lines.map(l=>({charge_type_id:l.charge_type_id,amount:Number(l.amount)})),p_reason:reason.trim()||null});if(r.error)throw r.error;await onChanged();onClose();}catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 return <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/45 p-3"><section role="dialog" aria-modal="true" className="w-full max-w-lg rounded-lg bg-white p-3 text-xs shadow-2xl">
  <div className="flex items-start justify-between"><div><h2 className="text-sm font-bold">Trip Charges · {trip?.trip_no??''}</h2><p className="text-[10px] text-slate-500">{trip?.customer_name_snapshot} · {trip?.from_location} → {trip?.to_location}</p></div><button className="btn h-7" disabled={busy} onClick={onClose}>Close</button></div>
  {trip?.posted&&<p className="my-2 rounded border border-amber-300 bg-amber-50 p-2 font-semibold text-amber-800">Customer invoice posted — customer-side Trip data and charges are locked. Use Credit / Debit Note for correction.</p>}
  {error&&<p role="alert" className="my-2 rounded bg-red-50 p-2 text-red-700">{error}</p>}
  <div className="my-2 rounded border bg-slate-50 p-2"><div className="grid grid-cols-3 gap-2 text-center"><div><span className="block text-[9px] text-slate-500">Base Rate</span><strong>{base.toFixed(2)}</strong></div><div><span className="block text-[9px] text-slate-500">Charges</span><strong>{chargesTotal.toFixed(2)}</strong></div><div><span className="block text-[9px] text-slate-500">Customer Rate</span><strong>{final.toFixed(2)}</strong></div></div></div>
  <div className="space-y-1">{lines.map((l,i)=><div key={l.id??`${l.charge_type_id}-${i}`} className="grid grid-cols-[1fr_110px_28px] items-center gap-1 rounded border p-1"><div><strong>{l.code}</strong> · {l.name}{!applicable(l.charge_type_id)&&<span className="ml-1 text-amber-700">No quotation rate</span>}</div><input aria-label={`${l.name} amount`} className="input h-7 text-right" type="number" min="0" step="0.01" disabled={busy||trip?.posted} value={l.amount} onChange={e=>setLines(v=>v.map((x,n)=>n===i?{...x,amount:e.target.value}:x))}/><button title="Remove charge" className="btn h-7 px-1 text-red-700" disabled={busy||trip?.posted} onClick={()=>setLines(v=>v.filter((_,n)=>n!==i))}>×</button></div>)}</div>
  {!trip?.posted&&<div className="mt-2 flex gap-1"><select className="input h-8 flex-1" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select charge…</option>{types.map(t=>{const r=applicable(t.id);return <option key={t.id} value={t.id}>{t.code} · {t.name}{r?.status==='agreed'&&r.amount!=null?` · ${Number(r.amount).toFixed(2)}`:r?.status==='pending'?' · Pending':' · No rate'}</option>})}</select><button className="btn h-8" disabled={!selected||busy} onClick={add}>+ Add</button></div>}
  {trip?.customer_rate_state==='finalized'&&!trip?.posted&&<label className="mt-2 block">Reason <input className="input h-8 w-full" value={reason} onChange={e=>setReason(e.target.value)} placeholder="Required because rate was already finalized"/></label>}
  <p className="mt-2 text-[10px] text-slate-500">Each charge is a separate line. Add/remove/edit recalculates the total; nothing is posted until the customer invoice is posted.</p>
  {!trip?.posted&&<div className="mt-3 flex justify-end gap-2"><button className="btn" disabled={busy} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy||lines.some(l=>l.amount===''||Number(l.amount)<0)||(trip?.customer_rate_state==='finalized'&&!reason.trim())} onClick={()=>void save()}>Save Charges · {final.toFixed(2)}</button></div>}
 </section></div>;
}
