import TransportReasonSelect from './TransportReasonSelect';
import TransportDialog from './TransportDialog';
import NaviloSearchableSelect from "@/components/SearchableSelect";
import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {supabase} from '@/lib/supabase';
import {validBulkMoney} from './transportBulkRates';

type Charge={id:string;code:string;name:string;default_rate?:number|null};
type Line={id?:string;charge_type_id:string;code:string;name:string;amount:string};
export default function TransportSupplierCharges({rentId,tripNo,onClose,onChanged,editRate=false,rateAllowed=false,headerExtra}:{rentId:string;tripNo:string;onClose:()=>void;onChanged:()=>Promise<void>;editRate?:boolean;rateAllowed?:boolean;headerExtra?:ReactNode}){
 const [rent,setRent]=useState<any>(null),[types,setTypes]=useState<Charge[]>([]),[lines,setLines]=useState<Line[]>([]);
 const [selected,setSelected]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [baseInput,setBaseInput]=useState('');const submitting=useRef(false);const savedLines=useRef('');
 async function load(){
  const rr=await supabase.from('transport_trip_supplier_rents').select('id,trip_id,company_id,business_unit_id,supplier_name_snapshot,amount,base_amount,state,finalized_amount_snapshot').eq('id',rentId).single();
  if(rr.error)throw rr.error;
  const [cm,ln,posted]=await Promise.all([
   supabase.from('charge_master').select('id,charge_key,charge_name,default_rate').eq('company_id',rr.data.company_id).eq('is_active',true).in('applies_to',['purchase','both']).order('charge_key'),
   supabase.from('transport_trip_supplier_charges').select('id,charge_master_id,charge_key_snapshot,name_snapshot,amount').eq('rent_id',rentId).order('sort_order').order('id'),
   supabase.from('transport_supplier_document_rents').select('id').eq('rent_id',rentId).eq('is_adjustment',false).limit(1)
  ]);for(const x of [cm,ln,posted])if(x.error)throw x.error;
  setRent({...rr.data,posted:(posted.data??[]).length>0});
  const savedCharges=(ln.data??[]).reduce((sum:number,x:any)=>sum+Number(x.amount),0);
  setBaseInput(String(rr.data.base_amount??Math.max(0,Number(rr.data.amount)-savedCharges)));
  setTypes((cm.data??[]).map((x:any)=>({id:x.id,code:x.charge_key,name:x.charge_name,default_rate:x.default_rate})));
  savedLines.current=JSON.stringify((ln.data??[]).map((x:any)=>({charge_type_id:x.charge_master_id,amount:Number(x.amount)})));
  setLines((ln.data??[]).map((x:any)=>({id:x.id,charge_type_id:x.charge_master_id,code:x.charge_key_snapshot,name:x.name_snapshot,amount:String(x.amount)})));
 }
 useEffect(()=>{void load().catch(e=>setError(e.message))},[rentId]);
 const charges=useMemo(()=>lines.reduce((s,x)=>s+(Number(x.amount)||0),0),[lines]);
 const base=Number(baseInput)||0;const total=base+charges;
 const invalid=lines.some(x=>!validBulkMoney(x.amount))||(editRate&&!validBulkMoney(baseInput));
 const reasonRequired=editRate||rent?.state==='finalized';
 function add(){const t=types.find(x=>x.id===selected);if(!t||lines.some(x=>x.charge_type_id===t.id))return;setLines(v=>[...v,{charge_type_id:t.id,code:t.code,name:t.name,amount:t.default_rate!=null?String(t.default_rate):''}]);setSelected('');}
 async function save(){
  if(!rent||rent.posted||invalid||(reasonRequired&&!reason.trim())||(editRate&&!rateAllowed)||submitting.current)return;
  submitting.current=true;setBusy(true);setError('');let chargesSaved=false,rateSaved=false,completed=false;
  try{
   const payload=lines.map(x=>({charge_type_id:x.charge_type_id,amount:Number(x.amount)}));
   if(JSON.stringify(payload)!==savedLines.current){
    const result=await supabase.rpc('transport_replace_trip_supplier_charges',{p_rent_id:rentId,p_lines:payload,p_reason:reason.trim()||null});if(result.error)throw result.error;
    chargesSaved=true;savedLines.current=JSON.stringify(payload);
   }
   if(editRate&&(rent.state!=='finalized'||rent.base_amount==null||Number(rent.base_amount)!==base)){
    const rate=await supabase.rpc('transport_finalize_supplier_rent',{p_rent_id:rentId,p_amount:base,p_reason:reason.trim()});if(rate.error)throw rate.error;
    rateSaved=true;setRent((current:any)=>({...current,base_amount:base,state:'finalized'}));
   }
   completed=true;await onChanged();onClose();
  }catch(e:any){
   setError(`${completed?'Saved; register refresh failed. ':chargesSaved?'Charges saved; base rent was not confirmed. Retry Save to finish. ':''}${e.message}`);
   if(chargesSaved&&!rateSaved){try{await onChanged()}catch{}}
  }finally{submitting.current=false;setBusy(false)}
 }
 return <TransportDialog onClose={busy?undefined:onClose}><section role="dialog" aria-modal="true" aria-labelledby="supplier-charges-title" className="w-full max-w-lg rounded-lg bg-white p-3 text-xs shadow-2xl">
  <div className="flex items-start justify-between"><div><h2 id="supplier-charges-title" className="text-sm font-bold">{editRate?'Supplier Rate & Charges':'Supplier Charges'} · {tripNo}</h2><p className="text-[10px] text-slate-500">{rent?.supplier_name_snapshot||'Supplier'} · Base rent + purchase charges = total supplier rent</p></div><button className="btn h-7" disabled={busy} onClick={onClose}>Close</button></div>
  {!rent&&!error&&<p role="status">Loading supplier rate and charges…</p>}
  <fieldset disabled={busy}>{headerExtra}</fieldset>
  {rent?.posted&&<p className="my-2 rounded border border-amber-300 bg-amber-50 p-2 font-semibold text-amber-800">Supplier invoice posted — charges are locked. Use controlled AP correction.</p>}
  {error&&<p role="alert" className="my-2 rounded bg-red-50 p-2 text-red-700">{error}</p>}
  <div className="my-2 grid grid-cols-3 gap-2 rounded border bg-slate-50 p-2 text-center"><div><span className="block text-[9px] text-slate-500">Base Rent</span><strong>{base.toFixed(2)}</strong></div><div><span className="block text-[9px] text-slate-500">Charges</span><strong>{charges.toFixed(2)}</strong></div><div><span className="block text-[9px] text-slate-500">Total Rent</span><strong>{total.toFixed(2)}</strong></div></div>
  {editRate&&<label className="mb-2 block font-semibold">Supplier rate excluding VAT<input aria-label="Supplier rate excluding VAT" autoFocus className="input mt-1 h-8 w-full" type="number" min="0" step="0.01" value={baseInput} disabled={!rent||busy||rent.posted||!rateAllowed} onChange={e=>setBaseInput(e.target.value)}/><span className="text-[10px] font-normal text-slate-500">Base rent only; the charges below are added to it.</span></label>}
  <div className="space-y-1">{lines.map((l,i)=><div key={l.id??l.charge_type_id} className="grid grid-cols-[1fr_110px_28px] items-center gap-1 rounded border p-1"><div><strong>{l.code}</strong> · {l.name}</div><input aria-label={`${l.name} amount`} className="input h-7 text-right" type="number" min="0" step="0.01" disabled={busy||rent?.posted} value={l.amount} onChange={e=>setLines(v=>v.map((x,n)=>n===i?{...x,amount:e.target.value}:x))}/><button className="btn h-7 px-1 text-red-700" disabled={busy||rent?.posted} onClick={()=>setLines(v=>v.filter((_,n)=>n!==i))}>×</button></div>)}</div>
  {!rent?.posted&&<div className="mt-2 flex gap-1"><NaviloSearchableSelect nativeCompatibility preserveLabel aria-label="Supplier charge" className="input h-8 flex-1" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Select another purchase charge…</option>{types.filter(t=>!lines.some(x=>x.charge_type_id===t.id)).map(t=><option key={t.id} value={t.id}>{t.code} · {t.name}{t.default_rate!=null?` · ${Number(t.default_rate).toFixed(2)}`:' · Enter amount'}</option>)}</NaviloSearchableSelect><button className="btn h-8 whitespace-nowrap" disabled={!selected||busy} onClick={add}>+ Add More Charge</button></div>}
  {reasonRequired&&!rent?.posted&&<TransportReasonSelect className="mt-2" kind={editRate?'supplier_rate':'supplier_charges'} label={editRate?'Reason':'Charge correction reason'} value={reason} onChange={setReason} disabled={busy}/>}
  <p className="mt-2 text-[10px] text-slate-500">Add/remove/edit charges recalculates the total. Saving {editRate?'finalizes the rent and saves charges':'saves charges'}; nothing is posted until the supplier invoice is posted.</p>
  {!rent?.posted&&<div className="mt-3 flex justify-end gap-2"><button className="btn" disabled={busy} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!rent||busy||invalid||(reasonRequired&&!reason.trim())||(editRate&&!rateAllowed)} onClick={()=>void save()}>{busy?'Saving…':editRate?'Save Rate & Charges':'Save Charges'} · {total.toFixed(2)}</button></div>}
 </section></TransportDialog>;
}
