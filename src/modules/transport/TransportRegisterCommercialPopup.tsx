import {useEffect,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import type {FinancialTrip} from './transportFinancialTypes';
import TransportDialog from './TransportDialog';
import TransportCommercialHeader from './TransportCommercialHeader';
import TransportReasonSelect from './TransportReasonSelect';
import {defaultTransportReason} from './transportRateReasons';
import TransportTripCharges from './TransportTripCharges';
import TransportSupplierCharges from './TransportSupplierCharges';
import TransportInitialRate from './TransportInitialRate';
import TransportBulkSupplierRent from './TransportBulkSupplierRent';
import TransportRegisterLinkedInvoice from './TransportRegisterLinkedInvoice';

export type RegisterPopupKind='company_rate'|'charge'|'rent_driver'|'supplier_charges'|'invoice_no'|'supplier_invoice_no';
export default function TransportRegisterCommercialPopup({trip,kind,onClose,onChanged}:{trip:FinancialTrip;kind:RegisterPopupKind;onClose:()=>void;onChanged:()=>Promise<void>}){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const side=kind==='rent_driver'||kind==='supplier_charges'||kind==='supplier_invoice_no'?'supplier':'customer';
 const [context,setContext]=useState<any>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[view,setView]=useState<RegisterPopupKind>(kind),[rentKey,setRentKey]=useState('');
 const [previewReason,setPreviewReason]=useState(defaultTransportReason(side==='customer'?'customer_rate':'supplier_rate'));
 useEffect(()=>{let active=true;const controller=new AbortController();const timer=window.setTimeout(()=>controller.abort(),12000);setContext(null);setError('');
  void (async()=>{try{
   const {data,error}=await supabase.rpc('transport_register_popup_context',{p_trip_id:trip.id,p_side:side}).abortSignal(controller.signal);
   if(!active)return;if(error)throw error;
   if(data?.trip?.id!==trip.id||data?.side!==side)throw new Error('The selected Trip could not be verified.');
   setContext(data);
  }catch(e:any){if(active)setError(controller.signal.aborted?'This Trip took too long to load. Retry.':e?.message||'Could not load this Trip.');}finally{window.clearTimeout(timer);}})();
  return()=>{active=false;window.clearTimeout(timer);controller.abort();};
 },[trip.id,side,revision,activeCompany?.company_id,activeBusinessUnit?.business_unit_id]);
 async function changed(){await onChanged();setRevision(n=>n+1)}
 const current={...trip,...context?.trip} as any;
 if(!context)return <TransportDialog onClose={onClose}><section role="dialog" aria-modal="true" aria-label={`${side} ${view} Trip ${trip.trip_no}`} className="w-full max-h-[90vh] overflow-y-auto max-w-lg rounded-lg bg-white p-3 text-xs shadow-2xl">
  <TransportCommercialHeader side={side} title={view.includes('invoice')?'Linked Invoice':view==='charge'||view==='supplier_charges'?'Charges':`${side==='customer'?'Customer':'Supplier'} Rate & Charges`} tripNo={trip.trip_no} party={side==='customer'?trip.customer_name:(trip as any).owner_name} from={trip.from_location} to={trip.to_location} vehicle={trip.vehicle_no}/>
  {error?<p role="alert" className="my-2 text-red-700">{error}</p>:<p role="status" className="my-2">Loading this Trip only…</p>}
  {!view.includes('invoice')&&<TransportReasonSelect kind={side==='customer'?'customer_rate':'supplier_rate'} value={previewReason} onChange={setPreviewReason} disabled/>}
  <div className="mt-3 flex justify-end gap-2">{error&&<button className="btn" onClick={()=>setRevision(n=>n+1)}>Retry</button>}<button className="btn" onClick={onClose}>Cancel</button></div>
 </section></TransportDialog>;
 if(view==='invoice_no'||view==='supplier_invoice_no')return <TransportRegisterLinkedInvoice side={side} trip={current} context={context} onClose={onClose} onChanged={changed}/>;
 if(side==='customer'){
  if(current.draft_linked)return <TransportDialog onClose={onClose}><section role="dialog" aria-modal="true" className="w-full max-w-lg rounded-lg bg-white p-3 text-xs shadow-xl"><TransportCommercialHeader side="customer" title="Customer Rate · Draft Invoice" tripNo={current.trip_no} party={current.customer_name}/><p className="my-3">This Trip is linked to a draft invoice. Open that draft to review its Trip links before changing the rate or charges.</p><div className="flex justify-end gap-2"><button className="btn" onClick={onClose}>Close</button><button className="btn-primary" onClick={()=>setView('invoice_no')}>Open Draft Invoice</button></div></section></TransportDialog>;
  if(view==='company_rate'&&current.posted)return <TransportInitialRate trip={{...current,customer_rate_locked:true}} permission={context.permissions.adjustment===true} onClose={onClose} onChanged={onChanged}/>;
  return <TransportTripCharges tripId={trip.id} tripPreview={current} preloaded={context} editRate={view==='company_rate'} rateAllowed={context.permissions[current.customer_rate_state==='finalized'?'rate_override':'rate_finalize']===true} onClose={onClose} onChanged={onChanged}/>;
 }
 if(view==='rent_driver')return <TransportBulkSupplierRent compact initialTripId={trip.id} initialSupplierName={(trip as any).owner_name??undefined} popupContext={context} onClose={onClose} onChanged={onChanged}/>;
 const rents=(context.supplier_page?.rows??[]).filter((r:any)=>r.rent);
 const selected=rents.find((r:any)=>r.id===rentKey)||rents[0];
 if(!selected)return <TransportDialog onClose={onClose}><section role="dialog" aria-modal="true" className="w-full max-w-lg rounded-lg bg-white p-3 text-xs shadow-xl"><TransportCommercialHeader side="supplier" title="Supplier Charges" tripNo={current.trip_no} party={(trip as any).owner_name}/><p className="my-3">Add a supplier rate before saving supplier charges.</p><div className="flex justify-end gap-2"><button className="btn" onClick={onClose}>Close</button><button className="btn-primary" onClick={()=>setView('rent_driver')}>Open Supplier Rate</button></div></section></TransportDialog>;
 return <TransportSupplierCharges key={selected.id} rentId={selected.rent.id} tripNo={current.trip_no} preloaded={{rent:{...selected.rent,supplier_name_snapshot:selected.owner_name,posted:selected.posted||selected.draftLinked,draft_linked:selected.draftLinked},types:context.charge_types,lines:context.charge_lines.filter((l:any)=>l.rent_id===selected.rent.id)}} tripContext={{supplier:selected.owner_name,customer:current.customer_name,from:current.from_location,to:current.to_location,vehicle:current.vehicle_no}} headerExtra={rents.length>1?<label>Supplier rent<select className="input mt-1 w-full" aria-label="Supplier rent" value={selected.id} onChange={e=>setRentKey(e.target.value)}>{rents.map((r:any)=><option key={r.id} value={r.id}>{r.owner_name}</option>)}</select></label>:undefined} onClose={onClose} onChanged={onChanged}/>;
}
