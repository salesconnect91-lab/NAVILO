import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import TransportDialog from './TransportDialog';
import type {ServiceBalance} from './transportFinancialTypes';

type Props={
 side:'customer'|'supplier';
 order:{id:string;order_no:string;status:string};
 trips:Array<{trip_no?:string}>;
 lineCount:number;
 chargesCount:number;
 balance:ServiceBalance|null;
 transportAttributed:boolean;
 cash:boolean;
 onReleased:(invoiceNo:string,tripNo:string)=>void;
};

export default function TransportCreditedTripInvoiceRelease({side,order,trips,lineCount,chargesCount,balance,transportAttributed,cash,onReleased}:Props){
 const [allowed,setAllowed]=useState(false);
 const [open,setOpen]=useState(false);
 const [reason,setReason]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');

 const fullyCredited=balance!==null
  &&Number(balance.credited_gross??0)+0.01>=Number(balance.original_gross??0)
  &&Number(balance.outstanding_gross)<=0.01
  &&Number(balance.paid_gross)<=0.01
  &&Number(balance.refunded_gross)<=0.01;
 const eligible=side==='customer'&&order.status==='posted'&&transportAttributed
  &&trips.length===1&&lineCount===1&&chargesCount===0&&!cash&&fullyCredited;

 useEffect(()=>{
  let live=true;
  setAllowed(false);
  if(!eligible)return()=>{live=false};
  void supabase.rpc('transport_admin_invoice_trip_release_access').then(({data,error:permissionError})=>{
   if(live&&!permissionError)setAllowed(data===true);
  }).catch(()=>{if(live)setAllowed(false)});
  return()=>{live=false};
 },[eligible,side,order.id,order.status,transportAttributed,trips.length,lineCount,chargesCount,cash,
  balance?.credited_gross,balance?.original_gross,balance?.outstanding_gross,balance?.paid_gross,balance?.refunded_gross]);

 async function release(){
  if(!allowed||busy||reason.trim().length<10)return;
  const tripNo=String(trips[0]?.trip_no??'');
  if(!window.confirm(`Release Trip ${tripNo} from invoice ${order.order_no}? The invoice, journal and credit note remain in history.`))return;
  setBusy(true);setError('');
  try{
   const {data,error:rpcError}=await supabase.rpc('transport_admin_release_credited_trip_invoice',{
    p_order_id:order.id,p_reason:reason.trim()
   } as any);
   if(rpcError)throw rpcError;
   if(data?.success!==true)throw new Error('The database did not confirm the Trip link release.');
   setOpen(false);setReason('');
   onReleased(String(data.invoice_no??order.order_no),String(data.trip_no??tripNo));
  }catch(e:unknown){setError(e instanceof Error?e.message:String((e as {message?:string})?.message||'Unable to release this invoice from the Trip.'));}
  finally{setBusy(false)}
 }

 if(!eligible||!allowed)return null;
 return <>
  <button type="button" className="btn-secondary" onClick={()=>{setError('');setOpen(true)}}>Release Trip Link</button>
  {open&&<TransportDialog onClose={()=>{if(!busy)setOpen(false)}}>
   <section role="dialog" aria-modal="true" aria-label={`Release Trip from invoice ${order.order_no}`} className="w-full max-w-lg rounded-lg border bg-white p-4 shadow-xl">
    <h2 className="text-base font-semibold">Release Trip {trips[0]?.trip_no} from invoice</h2>
    <p className="my-2 text-sm">This fully credited invoice will stay in its audit history. Releasing only the Trip Register link makes the Trip available for a future invoice.</p>
    {error&&<p role="alert" className="my-2 text-sm text-red-700">{error}</p>}
    <label className="block text-xs">Audit reason<input aria-label="Trip link release reason" className="input mt-1 w-full" value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} placeholder="Why should this credited invoice be released?"/></label>
    <div className="mt-3 flex justify-end gap-2"><button className="btn" disabled={busy} onClick={()=>setOpen(false)}>Cancel</button><button className="btn-primary" disabled={busy||reason.trim().length<10} onClick={()=>void release()}>{busy?'Releasing…':'Confirm Trip Link Release'}</button></div>
   </section>
  </TransportDialog>}
 </>;
}
