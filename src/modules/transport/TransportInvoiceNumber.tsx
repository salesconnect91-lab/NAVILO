import TransportVatPreview from './TransportVatPreview';
import NaviloDateInput from '@/components/NaviloDateInput';
import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {type FinancialTrip} from './transportFinancialTypes';

type InvoiceTrip=FinancialTrip & {invoice_no?:string|null};

export default function TransportInvoiceNumber({trip,onClose,onChanged}:{trip:InvoiceTrip;onClose:()=>void;onChanged:()=>Promise<void>}){
 const posted=Boolean(trip.invoiced||trip.customer_rate_locked||trip.invoice_no||Number(trip.billed_customer_net??0)>0);
 const [invoiceNo,setInvoiceNo]=useState(trip.invoice_no??'');
 const [date,setDate]=useState(new Date().toISOString().slice(0,10));
 const [withTax,setWithTax]=useState(false);const [vatReady,setVatReady]=useState(true);
 const [allowed,setAllowed]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const dialog=useRef<HTMLElement>(null);const input=useRef<HTMLInputElement>(null);

 useEffect(()=>{
  let active=true;input.current?.focus();
  if(posted){setAllowed(false);return()=>{active=false};}
  void supabase.rpc('transport_finance_allowed',{p_action:'billing'}).then(({data,error}:any)=>{if(active){setAllowed(data===true);if(error)setError(error.message)}});
  return()=>{active=false};
 },[posted]);

 const number=invoiceNo.trim();
 const rateReady=trip.customer_rate_state==='finalized'&&Number(trip.customer_rate??0)>0;
 const canPost=!posted&&allowed&&rateReady&&Boolean(date)&&!busy&&(!withTax||vatReady);

 async function post(){
  if(!canPost)return;setBusy(true);setError('');
  try{
   const result=number
    ?await supabase.rpc('transport_post_customer_bill_numbered',{p_trip_id:trip.id,p_date:date,p_with_tax:withTax,p_invoice_no:number})
    :await supabase.rpc('transport_post_customer_bill',{p_trip_id:trip.id,p_date:date,p_with_tax:withTax});
   if(result.error)throw result.error;
   await onChanged();onClose();
  }catch(e:any){setError(e?.message||'Unable to post customer invoice. Refresh the Trip before retrying.')}finally{setBusy(false)}
 }

 return <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/40 p-3" onKeyDown={e=>{if(e.key==='Escape'&&!busy)onClose();if(e.key==='Tab'){const items=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)');if(items?.length){const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}}}}>
  <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="trip-invoice-title" className="w-full max-w-sm rounded bg-white p-4 text-sm shadow-xl">
   <h2 id="trip-invoice-title" className="font-semibold">Customer Invoice · {trip.trip_no}</h2>
   <p className="my-2 text-xs text-slate-600">{trip.customer_name}<br/>{trip.from_location} → {trip.to_location}<br/>Company Rate excluding VAT: {trip.customer_rate==null?'—':Number(trip.customer_rate).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</p>
   <label className="block text-xs font-semibold">Invoice Number
    <input ref={input} className="input mt-1 w-full" value={invoiceNo} readOnly={posted} disabled={busy} onChange={e=>setInvoiceNo(e.target.value)} placeholder="Blank = automatic NAVILO number"/>
   </label>
   {posted
    ?<p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">This canonical Sales invoice is already posted. Its invoice number is locked and is not overwritten from the Trips grid.</p>
    :<>
      <label className="mt-2 block text-xs font-semibold">Invoice Date
       <NaviloDateInput className="input mt-1 w-full" type="date" value={date} disabled={busy} onChange={e=>setDate(e.target.value)}/>
      </label>
      <label className="mt-2 inline-flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={withTax} disabled={busy} onChange={e=>setWithTax(e.target.checked)}/> With VAT</label>
      <TransportVatPreview side="customer" date={date} withTax={withTax} amounts={[Number(trip.customer_rate??0)]} onReady={setVatReady}/>
      {!rateReady&&<p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">Finalize a positive Company Rate first. Invoice posting remains disabled until then.</p>}
      <p className="mt-2 text-xs text-slate-600">Save here posts the canonical Sales/service invoice. Blank Invoice Number uses NAVILO automatic numbering.</p>
    </>}
   {error&&<p role="alert" className="my-2 text-red-700">{error}</p>}
   <div className="mt-3 flex justify-end gap-2"><button className="btn" disabled={busy} onClick={onClose}>Close</button>{!posted&&<button className="btn-primary" disabled={!canPost} onClick={()=>void post()}>{busy?'Posting…':'Post Invoice'}</button>}</div>
  </section>
 </div>;
}
