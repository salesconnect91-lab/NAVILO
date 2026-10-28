import TransportReasonSelect from './TransportReasonSelect';
import {useEffect,useMemo,useState} from 'react';
import TransportDialog from './TransportDialog';
import {supabase} from '@/lib/supabase';
import {financialNumber} from './transportFinancialTypes';

type ChargeEdit={charge_master_id:string;amount:string};
type LineEdit={base_amount:string;charges:ChargeEdit[];baseDirty?:boolean;chargesDirty?:boolean;manualAdjustment?:number};
type ChargeMaster={id:string;charge_name:string;default_rate:number};
type Side='customer'|'supplier';
type DraftRow={side:Side;document_id:string;order_id:string;invoice_no:string;invoice_date:string;party_name:string;trip_count:number};
type Context={side:Side;document_id:string;order_id:string;invoice_no:string;invoice_date:string;party_id:string;party_name:string;account_id:string|null;line_ids:string[];trip_ids:string[];supplier_invoice_no?:string|null};
type TripRow=Record<string,any>&{id:string;trip_no:string;trip_id?:string;from_location?:string;to_location?:string;trip_date?:string;customer_rate?:number;supplier_rent?:number;customer_rate_state?:string;rent?:{state?:string;finalized_amount_snapshot?:number};posted?:boolean;draftLinked?:boolean;legacyBlocked?:boolean};

const lineIdFor=(side:Side,row:TripRow)=>side==='customer'?String(row.id):String(row.id);

export default function TransportRegisterDraftInvoiceEditor({row,onClose,onSaved,mode='draft'}:{row:DraftRow;mode?:'draft'|'posted';onClose:()=>void;onSaved:()=>Promise<void>}){
 const posted=mode==='posted';
 const [reason,setReason]=useState(''),[edits,setEdits]=useState<Record<string,LineEdit>>({}),[chargeMasters,setChargeMasters]=useState<ChargeMaster[]>([]);
 const [context,setContext]=useState<Context|null>(null),[trips,setTrips]=useState<TripRow[]>([]),[selected,setSelected]=useState<string[]>([]);
 const [invoiceNo,setInvoiceNo]=useState(row.invoice_no),[invoiceDate,setInvoiceDate]=useState(row.invoice_date),[search,setSearch]=useState(''),[searchQuery,setSearchQuery]=useState('');
 useEffect(()=>{const timer=window.setTimeout(()=>setSearchQuery(search.trim()),300);return()=>window.clearTimeout(timer)},[search]);
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{let live=true;void (async()=>{setLoading(true);setError('');try{
  const result=await supabase.rpc(posted?'transport_register_posted_invoice_edit_context':'transport_register_draft_invoice_edit_context',{p_side:row.side,p_document_id:row.document_id});
  if(result.error)throw result.error;const data=result.data as Context;if(!data?.account_id)throw new Error('This draft has no active revenue/expense account. It needs an account mapping before it can be edited.');
  if(live){setContext(data);setInvoiceNo(data.invoice_no);setInvoiceDate(String(data.invoice_date).slice(0,10));setSelected(data.line_ids||[]);}
 }catch(e:any){if(live)setError(e?.message||'Could not load this draft for editing.')}finally{if(live)setLoading(false)}})();return()=>{live=false}},[row.side,row.document_id,posted]);

 useEffect(()=>{if(!context)return;let live=true;void (async()=>{setLoading(true);setError('');try{
  // Search is applied by the database before pagination, so a Trip outside the
  // first 500 rows can still be found without loading the entire register.
  const filters=row.side==='customer'?{party:context.party_id,search:searchQuery,columns:{},status:'',unpostedOnly:true}:{party:context.party_id,search:searchQuery,columns:{},status:''};
  const page=await supabase.rpc('transport_bulk_rate_page',{p_side:row.side,p_limit:500,p_offset:0,p_filters:filters});
  if(page.error)throw page.error;
  let candidates=(Array.isArray(page.data?.rows)?page.data.rows:[]) as TripRow[];
  if(row.side==='customer')candidates=candidates.filter(x=>x.customer_id===context.party_id&&x.customer_rate_state==='finalized'&&!x.customer_rate_locked);
  else candidates=candidates.filter(x=>String(x.party_id||x.owner_supplier_id||'')===context.party_id&&!x.posted&&!x.draftLinked&&!x.legacyBlocked&&x.rent?.state==='finalized');
  const current:TripRow[]=[];
  // Load linked Trips in small parallel batches. A sequential RPC per Trip made
  // larger invoices feel frozen while the editor rebuilt its current selection.
  const linkedTripIds=[...new Set(context.trip_ids||[])];
  for(let offset=0;offset<linkedTripIds.length;offset+=8){
   const batch=linkedTripIds.slice(offset,offset+8);
   const results=await Promise.all(batch.map(tripId=>supabase.rpc('transport_bulk_rate_page',{
    p_side:row.side,p_limit:500,p_offset:0,p_filters:{party:context.party_id,initialTrip:tripId,columns:{},status:''}
   })));
   for(const r of results){
    if(r.error)throw r.error;
    const rows=(Array.isArray(r.data?.rows)?r.data.rows:[]) as TripRow[];
    current.push(...rows.filter(x=>context.line_ids.includes(lineIdFor(row.side,x))));
   }
  }
  const merged=[...current,...candidates.filter(x=>!context.line_ids.includes(lineIdFor(row.side,x)))];
  if(posted&&merged.length){
   const ids=merged.map(x=>lineIdFor(row.side,x));
   const [base,charges,masters]=await Promise.all([
    row.side==='customer'?supabase.from('transport_trips').select('id,customer_base_rate,customer_rate,customer_manual_adjustment').in('id',ids):supabase.from('transport_trip_supplier_rents').select('id,base_amount,amount').in('id',ids),
    row.side==='customer'?supabase.from('transport_trip_customer_charges').select('trip_id,charge_master_id,amount').in('trip_id',ids):supabase.from('transport_trip_supplier_charges').select('rent_id,charge_master_id,amount').in('rent_id',ids),
    supabase.from('charge_master').select('id,charge_name,default_rate,applies_to').eq('is_active',true),
   ]);
   for(const response of [base,charges,masters])if(response.error)throw response.error;
   const initial:Record<string,LineEdit>={};
   for(const entry of base.data||[]){const item=entry as Record<string,any>;initial[item.id]={base_amount:String(row.side==='customer'?(item.customer_base_rate??item.customer_rate):(item.base_amount??item.amount)),manualAdjustment:Number(item.customer_manual_adjustment||0),charges:(charges.data||[]).filter(raw=>{const charge=raw as Record<string,any>;return (row.side==='customer'?charge.trip_id:charge.rent_id)===item.id}).map(raw=>{const charge=raw as Record<string,any>;return {charge_master_id:charge.charge_master_id,amount:String(charge.amount)}})};}
   if(live){setEdits(initial);setChargeMasters((masters.data||[]).filter(x=>x.applies_to==='both'||x.applies_to===(row.side==='customer'?'sales':'purchase')) as ChargeMaster[]);}
  }
  if(live)setTrips(merged);
 }catch(e:any){if(live)setError(e?.message||'Could not load eligible Trips for this draft.')}finally{if(live)setLoading(false)}})();return()=>{live=false}},[context,row.side,posted,searchQuery]);

 function changeLine(id:string,update:Partial<LineEdit>){setEdits(current=>({...current,[id]:{...current[id],...update}}));}
 const invalidEdits=posted&&selected.some(id=>{const edit=edits[id];return !edit||!Number.isFinite(Number(edit.base_amount))||Number(edit.base_amount)<=0||edit.charges.some(charge=>!charge.charge_master_id||!Number.isFinite(Number(charge.amount))||Number(charge.amount)<=0)});
 const visible=useMemo(()=>trips.filter(x=>`${x.trip_no||''} ${x.from_location||''} ${x.to_location||''} ${x.vehicle_no||''} ${x.driver_name||''} ${x.po_do_job_no||''}`.toLowerCase().includes(search.trim().toLowerCase())),[trips,search]);
 const amountFor=(trip:TripRow)=>{const edit=edits[lineIdFor(row.side,trip)];return posted&&edit?Number(edit.base_amount)+Number(edit.manualAdjustment||0)+edit.charges.reduce((sum,charge)=>sum+Number(charge.amount),0):row.side==='customer'?Number(trip.customer_rate??0):Number(trip.rent?.finalized_amount_snapshot??trip.supplier_rent??0)};
 const selectedRows=trips.filter(x=>selected.includes(lineIdFor(row.side,x)));
 function toggle(id:string,checked:boolean){setSelected(current=>checked?[...new Set([...current,id])]:current.filter(x=>x!==id))}
 async function save(){if(!context||saving||selected.length===0)return;setSaving(true);setError('');setMessage('');try{
  const changes=Object.fromEntries(selected.filter(id=>edits[id]?.baseDirty||edits[id]?.chargesDirty).map(id=>[id,{...(edits[id].baseDirty?{base_amount:Number(edits[id].base_amount)}:{}),...(edits[id].chargesDirty?{charges:edits[id].charges.map(charge=>({charge_master_id:charge.charge_master_id,amount:Number(charge.amount)}))}:{})}]));
  const result=posted?await supabase.rpc('transport_admin_edit_posted_invoice',{p_side:row.side,p_order_id:row.order_id,p_line_ids:selected,p_invoice_date:invoiceDate,p_reason:reason.trim(),p_edits:changes}):await supabase.rpc('transport_edit_register_draft_invoice',{p_side:row.side,p_document_id:row.document_id,p_line_ids:selected,p_invoice_date:invoiceDate,p_invoice_no:invoiceNo.trim(),p_account_id:context.account_id});
  if(result.error)throw result.error;setMessage(`${posted?'Posted invoice':'Draft'} ${result.data?.invoice_no||invoiceNo} updated on the same invoice record.`);await onSaved();onClose();
 }catch(e:any){setError(e?.message||'Could not update this draft invoice.')}finally{setSaving(false)}}

 return <TransportDialog onClose={()=>{if(!saving)onClose()}}><section role="dialog" aria-modal="true" aria-label={`Edit ${posted?'Posted':'Draft'} Invoice ${row.invoice_no}`} className="flex max-h-[90vh] w-[min(1100px,96vw)] flex-col overflow-hidden rounded-lg border border-slate-300 bg-white p-3 text-xs shadow-xl">
  <header className="mb-2 flex items-center justify-between border-b border-slate-200 pb-2"><div><h2 className="text-sm font-bold">Edit {posted?'Posted':'Draft'} Invoice · {row.invoice_no}</h2><p className="text-[10px] text-slate-500">{posted?'Admin correction updates this invoice, its original journal and Trip links together. No reversal is created.':'Same draft record and invoice number are retained unless you change the number. Only this unposted draft’s Trip links are replaced.'}</p></div><button className="btn" disabled={saving} onClick={onClose}>Cancel</button></header>
  {error&&<p role="alert" className="mb-2 rounded border border-red-200 bg-red-50 p-2 text-red-700">{error}</p>}{message&&<p role="status" className="mb-2 rounded border border-emerald-200 bg-emerald-50 p-2 text-emerald-700">{message}</p>}
  <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-3"><label className="text-[10px] font-semibold">Invoice Number<input aria-label="Draft invoice number" className="input mt-1 h-8 w-full" maxLength={80} value={invoiceNo} disabled={posted||loading||saving} onChange={e=>setInvoiceNo(e.target.value)}/></label><label className="text-[10px] font-semibold">Invoice Date<input aria-label="Draft invoice date" className="input mt-1 h-8 w-full" type="date" value={invoiceDate} disabled={loading||saving} onChange={e=>setInvoiceDate(e.target.value)}/></label><label className="text-[10px] font-semibold">Find Trip<input aria-label="Search editable draft trips" className="input mt-1 h-8 w-full" placeholder="Trip, route, vehicle or job…" value={search} disabled={loading||saving} onChange={e=>setSearch(e.target.value)}/></label></div>
  {context&&<div className="mb-2 rounded border bg-slate-50 px-2 py-1 text-[10px]"><strong>{context.party_name}</strong> · {selected.length} Trip line(s) selected · VAT follows the saved invoice type and effective rate for the invoice date.</div>}
  <div className="min-h-0 flex-1 overflow-auto rounded border border-slate-200"><table className="w-full min-w-[700px] text-left text-[11px]"><thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">Use</th><th>Trip</th><th>Date</th><th>Route</th><th>Vehicle · Driver</th><th>Job / PO / DO</th><th className="text-right">Net</th>{posted&&<th className="px-2">Base rate / Charges</th>}</tr></thead><tbody>{visible.map((trip,index)=>{const lineId=lineIdFor(row.side,trip),current=context?.line_ids.includes(lineId)??false;const amount=amountFor(trip);return <tr key={`${lineId}-${index}`} className="border-t"><td className="p-2"><input aria-label={`Include Trip ${trip.trip_no}`} type="checkbox" checked={selected.includes(lineId)} disabled={saving||loading} onChange={e=>toggle(lineId,e.target.checked)}/></td><td className="font-semibold">{trip.trip_no}{current&&<span className="ml-1 text-[9px] text-blue-700">Current {posted?'invoice':'draft'}</span>}</td><td>{String(trip.trip_date||'').slice(0,10)}</td><td>{trip.from_location||'—'} → {trip.to_location||'—'}</td><td>{trip.vehicle_no||'—'} · {trip.driver_name||'—'}</td><td>{trip.po_do_job_no||'—'}</td><td className="pr-2 text-right tabular-nums">{financialNumber(amount)}</td>{posted&&<td className="min-w-56 p-2">
 <label className="text-[10px]">Base rate<input aria-label={`Base rate Trip ${trip.trip_no}`} className="input h-7 w-28" type="number" min="0.01" step="0.01" value={edits[lineId]?.base_amount??''} disabled={saving||loading||!selected.includes(lineId)} onChange={e=>changeLine(lineId,{base_amount:e.target.value,baseDirty:true})}/></label>
 <details><summary className="cursor-pointer">Charges ({edits[lineId]?.charges.length??0})</summary>
 {(edits[lineId]?.charges||[]).map((charge,chargeIndex)=><div key={charge.charge_master_id} className="my-1 flex items-center gap-1"><span>{chargeMasters.find(master=>master.id===charge.charge_master_id)?.charge_name||'Saved charge'}</span><input aria-label={`Charge ${chargeIndex+1} amount Trip ${trip.trip_no}`} className="input h-7 w-20" type="number" min="0.01" step="0.01" value={charge.amount} disabled={saving||!selected.includes(lineId)} onChange={e=>changeLine(lineId,{charges:edits[lineId].charges.map((item,i)=>i===chargeIndex?{...item,amount:e.target.value}:item),chargesDirty:true})}/><button type="button" className="btn" aria-label={`Remove charge ${chargeIndex+1} Trip ${trip.trip_no}`} disabled={saving||!selected.includes(lineId)} onClick={()=>changeLine(lineId,{charges:edits[lineId].charges.filter((_,i)=>i!==chargeIndex),chargesDirty:true})}>−</button></div>)}
 <select aria-label={`Add charge Trip ${trip.trip_no}`} className="input h-7 max-w-56" value="" disabled={saving||!selected.includes(lineId)} onChange={e=>{const master=chargeMasters.find(item=>item.id===e.target.value);if(master)changeLine(lineId,{charges:[...(edits[lineId]?.charges||[]),{charge_master_id:master.id,amount:String(master.default_rate||0)}],chargesDirty:true})}}><option value="">+ Add Charge</option>{chargeMasters.filter(master=>!edits[lineId]?.charges.some(charge=>charge.charge_master_id===master.id)).map(master=><option key={master.id} value={master.id}>{master.charge_name}</option>)}</select>
 </details></td>}</tr>})}{!loading&&visible.length===0&&<tr><td colSpan={posted?8:7} className="p-4 text-center text-slate-500">No eligible Trips found for this party and search.</td></tr>}</tbody></table>{loading&&<p role="status" className="p-4 text-center">Loading Trips…</p>}</div>
  {selectedRows.length>0&&<p className="mt-2 text-right text-[11px]">Selected net amount: <strong>{financialNumber(selectedRows.reduce((sum,t)=>sum+amountFor(t),0))}</strong></p>}
  {posted&&<TransportReasonSelect className="mt-2" kind="finance" label="Posted invoice edit reason" value={reason} onChange={setReason} disabled={saving}/> }
  <footer className="mt-2 flex items-center justify-between"><span className="text-[10px] text-slate-500">{posted?'Save updates the posted invoice and original journal atomically. Existing payments stay linked; credit notes, stock and other dependent records must be resolved first.':'Editing changes trip links and draft totals together. Posting remains a separate action.'}</span><div className="flex gap-2"><button className="btn" disabled={saving} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={loading||saving||!context?.account_id||!invoiceDate||!invoiceNo.trim()||selected.length===0||invalidEdits||(posted&&reason.trim().length<10)} onClick={()=>void save()}>{saving?'Saving…':posted?'Save Posted Changes':'Save Draft Changes'}</button></div></footer>
 </section></TransportDialog>
}
