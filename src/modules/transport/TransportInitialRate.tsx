import NaviloDateInput from '@/components/NaviloDateInput';
import {useEffect,useRef,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import {type FinancialTrip} from './transportFinancialTypes';

export default function TransportInitialRate({trip,onClose,onChanged}:{trip:FinancialTrip;onClose:()=>void;onChanged:()=>Promise<void>}){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const posted=Boolean(trip.customer_rate_locked||trip.invoiced||Number(trip.billed_customer_net??0)>0);
 const finalized=trip.customer_rate_state==='finalized';
 const [amount,setAmount]=useState(trip.billed_customer_net==null?(trip.customer_rate==null?'':String(trip.customer_rate)):String(trip.billed_customer_net));
 const [reason,setReason]=useState('');
 const [date,setDate]=useState(new Date().toISOString().slice(0,10));
 const [allowed,setAllowed]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const [saved,setSaved]=useState(false);const input=useRef<HTMLInputElement>(null);const dialog=useRef<HTMLElement>(null);

 useEffect(()=>{
  let active=true;setAllowed(false);input.current?.focus();
  const permission=posted
   ?supabase.rpc('transport_finance_allowed',{p_action:'adjustment'})
   :supabase.rpc('has_transport_action_permission',{p_company_id:activeCompany?.company_id,p_action:finalized?'customer_rate_override':'customer_rate_finalize'});
  void permission.then(({data,error}:any)=>{if(active){setAllowed(data===true);if(error)setError(error.message)}});
  return()=>{active=false};
 },[activeCompany?.company_id,activeBusinessUnit?.business_unit_id,posted,finalized]);

 const valid=amount.trim()!==''&&Number.isFinite(Number(amount))&&Number(amount)>=0&&/^\d+(\.\d{1,2})?$/.test(amount);
 const changed=valid&&Number(amount)!==Number(posted?(trip.billed_customer_net??trip.customer_rate??0):(trip.customer_rate??0));
 const reasonRequired=posted||finalized;

 async function save(){
  if(!allowed||!valid||busy||saved||!changed||(reasonRequired&&!reason.trim())||(posted&&!date))return;
  setBusy(true);setError('');
  try{
   const result=posted
    ?await supabase.rpc('transport_adjust_rate',{p_trip_id:trip.id,p_side:'customer',p_new_rate:Number(amount),p_reason:reason.trim(),p_date:date,p_rent_id:null,p_reference:'Trips grid company rate correction'})
    :finalized
      ?await supabase.rpc('transport_finalize_customer_rate',{p_trip_id:trip.id,p_amount:Number(amount),p_source:'manual',p_reason:reason.trim()})
      :await supabase.rpc('transport_finalize_initial_customer_rate',{p_trip_id:trip.id,p_amount:Number(amount)});
   if(result.error)throw result.error;
   setSaved(true);await onChanged();onClose();
  }catch(e:any){setError(e?.message||'Unable to save company rate. Refresh the Trip before retrying.')}finally{setBusy(false)}
 }

 const title=posted?'Correct Company Rate':finalized?'Update Company Rate':'Add Company Rate';
 return <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/40 p-3" onKeyDown={e=>{if(e.key==='Escape'&&!busy)onClose();if(e.key==='Tab'){const items=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)');if(items?.length){const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}}}}>
 <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="initial-rate-title" className="w-full max-w-sm rounded bg-white p-4 text-sm shadow-xl">
  <h2 id="initial-rate-title" className="font-semibold">{title} · {trip.trip_no}</h2>
  <p className="my-2 text-xs text-slate-600">{trip.customer_name}<br/>{trip.from_location} → {trip.to_location}<br/>{trip.vehicle_no}</p>
  <label className="block text-xs font-semibold">Company rate excluding VAT
   <input ref={input} className="input mt-1 w-full" type="number" min="0" step="0.01" value={amount} disabled={busy||saved} onChange={e=>setAmount(e.target.value)}/>
  </label>
  {posted&&<label className="mt-2 block text-xs font-semibold">Correction Date
   <NaviloDateInput className="input mt-1 w-full" type="date" value={date} disabled={busy||saved} onChange={e=>setDate(e.target.value)}/>
  </label>}
  {reasonRequired&&<label className="mt-2 block text-xs font-semibold">Reason
   <input className="input mt-1 w-full" value={reason} disabled={busy||saved} onChange={e=>setReason(e.target.value)} placeholder={posted?'Required for posted accounting correction':'Required for rate override'}/>
  </label>}
  <p className="my-2 text-xs text-slate-600">{posted?'Posted billing is never overwritten. Saving creates the controlled canonical AR adjustment.':finalized?'This changes the finalized unposted Trip rate and records the override reason.':'Finalizing the initial rate records it in the Trip audit.'}</p>
  {error&&<p role="alert" className="my-2 text-red-700">{error}</p>}
  <div className="mt-3 flex justify-end gap-2"><button className="btn" disabled={busy} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!allowed||!valid||!changed||busy||saved||(reasonRequired&&!reason.trim())||(posted&&!date)} onClick={()=>void save()}>{saved?'Saved':posted?'Post Correction':'Save Rate'}</button></div>
 </section></div>;
}
