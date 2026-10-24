import {useEffect,useMemo,useState} from 'react';
import TransportDialog from './TransportDialog';
import {supabase} from '@/lib/supabase';
import {financialNumber} from './transportFinancialTypes';

type Side='customer'|'supplier';
type DraftRow={side:Side;document_id:string;order_id:string;invoice_no:string;invoice_date:string;party_name:string;trip_count:number};
type Context={side:Side;document_id:string;order_id:string;invoice_no:string;invoice_date:string;party_id:string;party_name:string;account_id:string|null;line_ids:string[];trip_ids:string[];supplier_invoice_no?:string|null};
type TripRow=Record<string,any>&{id:string;trip_no:string;trip_id?:string;from_location?:string;to_location?:string;trip_date?:string;customer_rate?:number;supplier_rent?:number;customer_rate_state?:string;rent?:{state?:string;finalized_amount_snapshot?:number};posted?:boolean;draftLinked?:boolean;legacyBlocked?:boolean};

const lineIdFor=(side:Side,row:TripRow)=>side==='customer'?String(row.id):String(row.id);

export default function TransportRegisterDraftInvoiceEditor({row,onClose,onSaved}:{row:DraftRow;onClose:()=>void;onSaved:()=>Promise<void>}){
 const [context,setContext]=useState<Context|null>(null),[trips,setTrips]=useState<TripRow[]>([]),[selected,setSelected]=useState<string[]>([]);
 const [invoiceNo,setInvoiceNo]=useState(row.invoice_no),[invoiceDate,setInvoiceDate]=useState(row.invoice_date),[search,setSearch]=useState('');
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{let live=true;void (async()=>{setLoading(true);setError('');try{
  const result=await supabase.rpc('transport_register_draft_invoice_edit_context',{p_side:row.side,p_document_id:row.document_id});
  if(result.error)throw result.error;const data=result.data as Context;if(!data?.account_id)throw new Error('This draft has no active revenue/expense account. It needs an account mapping before it can be edited.');
  if(live){setContext(data);setInvoiceNo(data.invoice_no);setInvoiceDate(String(data.invoice_date).slice(0,10));setSelected(data.line_ids||[]);}
 }catch(e:any){if(live)setError(e?.message||'Could not load this draft for editing.')}finally{if(live)setLoading(false)}})();return()=>{live=false}},[row.side,row.document_id]);

 useEffect(()=>{if(!context)return;let live=true;void (async()=>{setLoading(true);setError('');try{
  const filters=row.side==='customer'?{party:context.party_id,search,columns:{},status:'',unpostedOnly:true}:{party:context.party_id,search,columns:{},status:''};
  const page=await supabase.rpc('transport_bulk_rate_page',{p_side:row.side,p_limit:500,p_offset:0,p_filters:filters});
  if(page.error)throw page.error;
  let candidates=(Array.isArray(page.data?.rows)?page.data.rows:[]) as TripRow[];
  if(row.side==='customer')candidates=candidates.filter(x=>x.customer_id===context.party_id&&x.customer_rate_state==='finalized'&&!x.customer_rate_locked);
  else candidates=candidates.filter(x=>String(x.party_id||x.owner_supplier_id||'')===context.party_id&&!x.posted&&!x.draftLinked&&!x.legacyBlocked&&x.rent?.state==='finalized');
  const current:TripRow[]=[];
  for(const tripId of [...new Set(context.trip_ids||[])]){
   const r=await supabase.rpc('transport_bulk_rate_page',{p_side:row.side,p_limit:500,p_offset:0,p_filters:{party:context.party_id,initialTrip:tripId,columns:{},status:''}});
   if(r.error)throw r.error;
   const rows=(Array.isArray(r.data?.rows)?r.data.rows:[]) as TripRow[];
   current.push(...rows.filter(x=>context.line_ids.includes(lineIdFor(row.side,x))));
  }
  const merged=[...current,...candidates.filter(x=>!context.line_ids.includes(lineIdFor(row.side,x)))];
  if(live)setTrips(merged);
 }catch(e:any){if(live)setError(e?.message||'Could not load eligible Trips for this draft.')}finally{if(live)setLoading(false)}})();return()=>{live=false}},[context,row.side,search]);

 const visible=useMemo(()=>trips.filter(x=>`${x.trip_no||''} ${x.from_location||''} ${x.to_location||''} ${x.vehicle_no||''} ${x.driver_name||''} ${x.po_do_job_no||''}`.toLowerCase().includes(search.trim().toLowerCase())),[trips,search]);
 const selectedRows=trips.filter(x=>selected.includes(lineIdFor(row.side,x)));
 function toggle(id:string,checked:boolean){setSelected(current=>checked?[...new Set([...current,id])]:current.filter(x=>x!==id))}
 async function save(){if(!context||saving||selected.length===0)return;setSaving(true);setError('');setMessage('');try{
  const result=await supabase.rpc('transport_edit_register_draft_invoice',{p_side:row.side,p_document_id:row.document_id,p_line_ids:selected,p_invoice_date:invoiceDate,p_invoice_no:invoiceNo.trim(),p_account_id:context.account_id});
  if(result.error)throw result.error;setMessage(`Draft ${result.data?.invoice_no||invoiceNo} updated on the same invoice record.`);await onSaved();onClose();
 }catch(e:any){setError(e?.message||'Could not update this draft invoice.')}finally{setSaving(false)}}

 return <TransportDialog onClose={()=>{if(!saving)onClose()}}><section role="dialog" aria-modal="true" aria-label={`Edit Draft Invoice ${row.invoice_no}`} className="flex max-h-[90vh] w-[min(1100px,96vw)] flex-col overflow-hidden rounded-lg border border-slate-300 bg-white p-3 text-xs shadow-xl">
  <header className="mb-2 flex items-center justify-between border-b border-slate-200 pb-2"><div><h2 className="text-sm font-bold">Edit Draft Invoice · {row.invoice_no}</h2><p className="text-[10px] text-slate-500">Same draft record and invoice number are retained unless you change the number. Only this unposted draft's Trip links are replaced.</p></div><button className="btn" disabled={saving} onClick={onClose}>Cancel</button></header>
  {error&&<p role="alert" className="mb-2 rounded border border-red-200 bg-red-50 p-2 text-red-700">{error}</p>}{message&&<p role="status" className="mb-2 rounded border border-emerald-200 bg-emerald-50 p-2 text-emerald-700">{message}</p>}
  <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-3"><label className="text-[10px] font-semibold">Invoice Number<input aria-label="Draft invoice number" className="input mt-1 h-8 w-full" maxLength={80} value={invoiceNo} disabled={loading||saving} onChange={e=>setInvoiceNo(e.target.value)}/></label><label className="text-[10px] font-semibold">Invoice Date<input aria-label="Draft invoice date" className="input mt-1 h-8 w-full" type="date" value={invoiceDate} disabled={loading||saving} onChange={e=>setInvoiceDate(e.target.value)}/></label><label className="text-[10px] font-semibold">Find Trip<input aria-label="Search editable draft trips" className="input mt-1 h-8 w-full" placeholder="Trip, route, vehicle or job…" value={search} disabled={loading||saving} onChange={e=>setSearch(e.target.value)}/></label></div>
  {context&&<div className="mb-2 rounded border bg-slate-50 px-2 py-1 text-[10px]"><strong>{context.party_name}</strong> · {selected.length} Trip line(s) selected · VAT follows the saved invoice type and effective rate for the invoice date.</div>}
  <div className="min-h-0 flex-1 overflow-auto rounded border border-slate-200"><table className="w-full min-w-[700px] text-left text-[11px]"><thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">Use</th><th>Trip</th><th>Date</th><th>Route</th><th>Vehicle · Driver</th><th>Job / PO / DO</th><th className="text-right">Net</th></tr></thead><tbody>{visible.map((trip,index)=>{const lineId=lineIdFor(row.side,trip),current=context?.line_ids.includes(lineId)??false;const amount=row.side==='customer'?Number(trip.customer_rate??0):Number(trip.rent?.finalized_amount_snapshot??trip.supplier_rent??0);return <tr key={`${lineId}-${index}`} className="border-t"><td className="p-2"><input aria-label={`Include Trip ${trip.trip_no}`} type="checkbox" checked={selected.includes(lineId)} disabled={saving||loading} onChange={e=>toggle(lineId,e.target.checked)}/></td><td className="font-semibold">{trip.trip_no}{current&&<span className="ml-1 text-[9px] text-blue-700">Current draft</span>}</td><td>{String(trip.trip_date||'').slice(0,10)}</td><td>{trip.from_location||'—'} → {trip.to_location||'—'}</td><td>{trip.vehicle_no||'—'} · {trip.driver_name||'—'}</td><td>{trip.po_do_job_no||'—'}</td><td className="pr-2 text-right tabular-nums">{financialNumber(amount)}</td></tr>})}{!loading&&visible.length===0&&<tr><td colSpan={7} className="p-4 text-center text-slate-500">No eligible Trips found for this party and search.</td></tr>}</tbody></table>{loading&&<p role="status" className="p-4 text-center">Loading Trips…</p>}</div>
  {selectedRows.length>0&&<p className="mt-2 text-right text-[11px]">Selected net amount: <strong>{financialNumber(selectedRows.reduce((sum,t)=>sum+(row.side==='customer'?Number(t.customer_rate??0):Number(t.rent?.finalized_amount_snapshot??t.supplier_rent??0)),0))}</strong></p>}
  <footer className="mt-2 flex items-center justify-between"><span className="text-[10px] text-slate-500">Editing changes trip links and draft totals together. Posting remains a separate action.</span><div className="flex gap-2"><button className="btn" disabled={saving} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={loading||saving||!context?.account_id||!invoiceDate||!invoiceNo.trim()||selected.length===0} onClick={()=>void save()}>{saving?'Saving…':'Save Draft Changes'}</button></div></footer>
 </section></TransportDialog>
}
