import {useEffect,useRef,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import {type FinancialTrip} from './transportFinancialTypes';
export default function TransportInitialRate({trip,onClose,onChanged}:{trip:FinancialTrip;onClose:()=>void;onChanged:()=>Promise<void>}){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const [amount,setAmount]=useState(trip.customer_rate==null?'':String(trip.customer_rate));
 const [allowed,setAllowed]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const [saved,setSaved]=useState(false);const input=useRef<HTMLInputElement>(null);const dialog=useRef<HTMLElement>(null);
 useEffect(()=>{let active=true;setAllowed(false);input.current?.focus();void supabase.rpc('has_transport_action_permission',{p_company_id:activeCompany?.company_id,p_action:'customer_rate_finalize'}).then(({data,error}:any)=>{if(active){setAllowed(data===true);if(error)setError(error.message)}});return()=>{active=false}},[activeCompany?.company_id,activeBusinessUnit?.business_unit_id]);
 const valid=amount.trim()!==''&&Number.isFinite(Number(amount))&&Number(amount)>=0&&/^\d+(\.\d{1,2})?$/.test(amount);
 async function save(){if(!allowed||!valid||busy||saved)return;setBusy(true);setError('');try{
  const result=await supabase.rpc('transport_finalize_initial_customer_rate',{p_trip_id:trip.id,p_amount:Number(amount)});if(result.error)throw result.error;
  setSaved(true);await onChanged();onClose();
 }catch(e:any){setError(e?.message||'Unable to finalize rate. Refresh the Trip before retrying.')}finally{setBusy(false)}}
 return <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/40 p-3" onKeyDown={e=>{if(e.key==='Escape'&&!busy)onClose();if(e.key==='Tab'){const items=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)');if(items?.length){const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}}}}>
 <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="initial-rate-title" className="w-full max-w-sm rounded bg-white p-4 text-sm shadow-xl">
 <h2 id="initial-rate-title" className="font-semibold">Add Rate · {trip.trip_no}</h2>
 <p className="my-2">{trip.customer_name}<br/>{trip.from_location} → {trip.to_location}<br/>{trip.vehicle_no} · Rate pending</p>
 <label>Customer rate excluding VAT<input ref={input} className="input mt-1 w-full" type="number" min="0" step="0.01" value={amount} disabled={busy||saved} onChange={e=>setAmount(e.target.value)}/></label>
 <p className="my-2 text-xs text-slate-600">Finalize once. Later corrections require a reason through Finance → Correct Rate.</p>
 {error&&<p role="alert" className="my-2 text-red-700">{error}</p>}
 <div className="mt-3 flex justify-end gap-2"><button className="btn" disabled={busy} onClick={onClose}>Close</button><button className="btn-primary" disabled={!allowed||!valid||busy||saved} onClick={()=>void save()}>{saved?'Rate saved':'Finalize Rate'}</button></div>
 </section></div>;
}
