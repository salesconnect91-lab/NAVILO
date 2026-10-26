import TransportCommercialHeader,{TransportCommercialSummary} from './TransportCommercialHeader';
import TransportReasonSelect from './TransportReasonSelect';
import TransportDialog from './TransportDialog';
import NaviloSearchableSelect from "@/components/SearchableSelect";
import {useEffect,useMemo,useState} from 'react';
import {validBulkMoney} from './transportBulkRates';
import {supabase} from '@/lib/supabase';

type Line={id?:string;charge_type_id:string;code:string;name:string;amount:string;source_rate_id?:string|null};
type Charge={id:string;code:string;name:string;is_active:boolean;default_rate?:number|null};
type TripPreview={trip_no?:string|null;customer_name?:string|null;from_location?:string|null;to_location?:string|null};
export default function TransportTripCharges({tripId,onClose,onChanged,tripPreview,preloaded,editRate=false,rateAllowed=false}:{tripId:string;onClose:()=>void;onChanged:()=>Promise<void>;tripPreview?:TripPreview;preloaded?:any;editRate?:boolean;rateAllowed?:boolean}){
 const [trip,setTrip]=useState<any>(null),[types,setTypes]=useState<Charge[]>([]),[rates,setRates]=useState<any[]>([]),[lines,setLines]=useState<Line[]>([]);
 const [baseRate,setBaseRate]=useState(0);const [baseInput,setBaseInput]=useState('');
 const [selected,setSelected]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 async function load(){
  if(preloaded){
   const tr=preloaded.trip;const saved=preloaded.charge_lines??[];
   const savedCharges=saved.reduce((sum:number,x:any)=>sum+Number(x.amount),0);
   const base=Number(tr.customer_base_rate??Math.max(0,Number(tr.customer_rate??0)-savedCharges-Number(tr.customer_manual_adjustment??0)));
   setBaseRate(base);setBaseInput(String(base));setTrip(tr);setTypes(preloaded.charge_types??[]);setRates(preloaded.charge_rates??[]);
   setLines(saved.map((x:any)=>({id:x.id,charge_type_id:x.charge_master_id,code:x.code_snapshot,name:x.name_snapshot,amount:String(x.amount),source_rate_id:x.source_rate_id})));return;
  }

  const tr=await supabase.rpc('transport_edit_trip_read',{p_trip_id:tripId});
  if(tr.error)throw tr.error;
  const [ct,cr,ln,posted]=await Promise.all([
   supabase.from('charge_master').select('id,charge_key,charge_name,is_active,default_rate').eq('company_id',tr.data.company_id).eq('is_active',true).in('applies_to',['sales','both']).order('charge_key'),
   supabase.from('transport_customer_charge_rates').select('id,charge_master_id,amount,status,effective_from,effective_to').eq('company_id',tr.data.company_id).eq('business_unit_id',tr.data.business_unit_id).eq('customer_id',tr.data.customer_id).eq('is_active',true),
   supabase.from('transport_trip_customer_charges').select('*').eq('trip_id',tripId).order('sort_order').order('id'),
   supabase.rpc('transport_customer_side_posted',{p_trip_id:tripId})
  ]);for(const r of [ct,cr,ln,posted])if(r.error)throw r.error;
  const savedCharges=(ln.data??[]).reduce((sum:number,line:any)=>sum+Number(line.amount),0);
  setBaseRate(Number(tr.data.customer_base_rate??Math.max(0,Number(tr.data.customer_rate??0)-savedCharges-Number(tr.data.customer_manual_adjustment??0))));
  setTrip({...tr.data,posted:posted.data===true});setTypes((ct.data??[]).map((x:any)=>({id:x.id,code:x.charge_key,name:x.charge_name,is_active:x.is_active,default_rate:x.default_rate})));setRates(cr.data??[]);
  setLines((ln.data??[]).map((x:any)=>({id:x.id,charge_type_id:x.charge_master_id,code:x.code_snapshot,name:x.name_snapshot,amount:String(x.amount),source_rate_id:x.source_rate_id})));
 }
 useEffect(()=>{setLoading(true);setTrip(null);setError('');void load().catch(e=>setError(e.message)).finally(()=>setLoading(false))},[tripId,preloaded]);
 const applicable=(chargeTypeId:string)=>rates.filter(r=>r.charge_master_id===chargeTypeId&&r.effective_from<=trip?.trip_date&&(!r.effective_to||r.effective_to>=trip?.trip_date)).sort((a,b)=>b.effective_from.localeCompare(a.effective_from))[0];
 const chargesTotal=useMemo(()=>lines.reduce((s,l)=>s+(Number(l.amount)||0),0),[lines]);
 const base=editRate?Number(baseInput)||0:baseRate;
 const final=base+chargesTotal+Number(trip?.customer_manual_adjustment??0);
 const selectedCharge=selected||types.find(t=>!lines.some(x=>x.charge_type_id===t.id))?.id||'';
 function add(){
  const t=types.find(x=>x.id===selectedCharge);if(!t||lines.some(x=>x.charge_type_id===t.id))return;const r=applicable(t.id);
  const suggested=r?.status==='agreed'&&r.amount!=null?r.amount:t.default_rate;
  setLines(v=>[...v,{charge_type_id:t.id,code:t.code,name:t.name,amount:suggested!=null?String(suggested):'',source_rate_id:r?.id??null}]);setSelected('');
 }
 async function save(){
  if(!trip||trip.posted||lines.some(l=>l.amount===''||!Number.isFinite(Number(l.amount))||Number(l.amount)<0)||((editRate||trip.customer_rate_state==='finalized')&&!reason.trim())||(editRate&&(!rateAllowed||!validBulkMoney(baseInput))))return;
  setBusy(true);setError('');
  try{const payload=lines.map(l=>({charge_type_id:l.charge_type_id,amount:Number(l.amount)}));const r=editRate?await supabase.rpc('transport_save_customer_rate_and_charges',{p_trip_id:tripId,p_base_amount:Number(baseInput),p_lines:payload,p_reason:reason.trim()}):await supabase.rpc('transport_replace_trip_customer_charges',{p_trip_id:tripId,p_lines:payload,p_reason:reason.trim()||null});if(r.error)throw r.error;await onChanged();onClose();}catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 return <TransportDialog onClose={busy?undefined:onClose}><section role="dialog" aria-modal="true" className="w-full max-h-[90vh] overflow-y-auto max-w-lg rounded-lg bg-white p-3 text-xs shadow-2xl">
  <div className="mb-1 flex justify-end"><button className="btn h-7" disabled={busy} onClick={onClose}>Close</button></div>
  <TransportCommercialHeader title={editRate?'Customer Rate & Charges':'Customer Charges'} side="customer" tripNo={trip?.trip_no??tripPreview?.trip_no} party={trip?.customer_name_snapshot??tripPreview?.customer_name} from={trip?.from_location??tripPreview?.from_location} to={trip?.to_location??tripPreview?.to_location}/>

  {trip?.posted&&<p className="my-2 rounded border border-amber-300 bg-amber-50 p-2 font-semibold text-amber-800">Customer invoice posted — customer-side Trip data and charges are locked. Use Credit / Debit Note for correction.</p>}
  {error&&<p role="alert" className="my-2 rounded bg-red-50 p-2 text-red-700">{error}</p>}
  {loading?<p role="status" className="my-2 text-xs text-slate-600">Loading customer rate and saved charges…</p>:trip?<TransportCommercialSummary side="customer" base={base} charges={chargesTotal} total={final}/>:null}
  {!loading&&trip&&types.length===0&&<p role="status" className="my-2 rounded border border-amber-200 bg-amber-50 p-2 text-amber-900">No active customer charges configured. Add sales charges in Sales → Charges with the correct revenue account mapping before selecting charges here.</p>}

  {editRate&&<label className="mb-2 block font-semibold">Customer rate excluding VAT<input aria-label="Customer rate excluding VAT" className="input mt-1 h-8 w-full" type="number" min="0" step="0.01" value={baseInput} disabled={busy||loading||trip?.posted||!rateAllowed} onChange={e=>setBaseInput(e.target.value)}/><span className="text-[10px] font-normal text-slate-500">Base rate only; the charges below are added to it.</span></label>}
  <div className="space-y-1">{lines.map((l,i)=><div key={l.id??`${l.charge_type_id}-${i}`} className="grid grid-cols-[1fr_110px_28px] items-center gap-1 rounded border p-1"><div><strong>{l.code}</strong> · {l.name}{!applicable(l.charge_type_id)&&<span className="ml-1 text-amber-700">No quotation rate</span>}</div><input aria-label={`${l.name} amount`} className="input h-7 text-right" type="number" min="0" step="0.01" disabled={busy||trip?.posted} value={l.amount} onChange={e=>setLines(v=>v.map((x,n)=>n===i?{...x,amount:e.target.value}:x))}/><button title="Remove charge" className="btn h-7 px-1 text-red-700" disabled={busy||trip?.posted} onClick={()=>setLines(v=>v.filter((_,n)=>n!==i))}>×</button></div>)}</div>
  {!trip?.posted&&<div className="mt-2 flex gap-1"><NaviloSearchableSelect nativeCompatibility preserveLabel aria-label="Customer charge" className="input h-8 flex-1" value={selectedCharge} onChange={e=>setSelected(e.target.value)}><option value="">Select another customer charge…</option>{types.filter(t=>!lines.some(x=>x.charge_type_id===t.id)).map(t=>{const r=applicable(t.id);return <option key={t.id} value={t.id}>{t.code} · {t.name}{r?.status==='agreed'&&r.amount!=null?` · ${Number(r.amount).toFixed(2)}`:t.default_rate!=null?` · ${Number(t.default_rate).toFixed(2)}`:r?.status==='pending'?' · Pending':' · Enter amount'}</option>})}</NaviloSearchableSelect><button className="btn h-8 whitespace-nowrap" disabled={!selectedCharge||busy} onClick={add}>+ Add More Charge</button></div>}
  {(editRate||trip?.customer_rate_state==='finalized')&&!trip?.posted&&<TransportReasonSelect className="mt-2" kind={editRate?'customer_rate':'customer_charges'} label={editRate?'Reason':'Charge correction reason'} value={reason} onChange={setReason} disabled={busy}/>} 
  <p className="mt-2 text-[10px] text-slate-500">Each charge is a separate line. Add/remove/edit recalculates the total; nothing is posted until the customer invoice is posted.</p>
  {!trip?.posted&&<div className="mt-3 flex justify-end gap-2"><button className="btn" disabled={busy} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy||loading||!trip||lines.some(l=>l.amount===''||!Number.isFinite(Number(l.amount))||Number(l.amount)<0)||((editRate||trip?.customer_rate_state==='finalized')&&!reason.trim())||(editRate&&(!rateAllowed||!validBulkMoney(baseInput)))} onClick={()=>void save()}>{editRate?'Save Rate & Charges':'Save Charges'} · {final.toFixed(2)}</button></div>}
 </section></TransportDialog>;
}
