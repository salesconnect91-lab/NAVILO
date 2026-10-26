import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import type {FinancialTrip} from './transportFinancialTypes';
import {financialNumber} from './transportFinancialTypes';
import TransportDialog from './TransportDialog';
import TransportInvoiceNumber from './TransportInvoiceNumber';
import TransportBulkSupplierRent from './TransportBulkSupplierRent';
import TransportRegisterDraftInvoiceEditor from './TransportRegisterDraftInvoiceEditor';
import TransportPostedInvoiceControls from './TransportPostedInvoiceControls';
type Invoice={id:string;document_id:string;order_no:string;order_date:string;status:string;total:number};
export default function TransportRegisterLinkedInvoice({side,trip,onClose,onChanged,context}:{side:'customer'|'supplier';trip:FinancialTrip&{invoice_no?:string|null;owner_name?:string|null};onClose:()=>void;onChanged:()=>Promise<void>;context?:any}){
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[invoices,setInvoices]=useState<Invoice[]>([]);
 const [selected,setSelected]=useState(''),[revision,setRevision]=useState(0),[editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[draftPermissions,setDraftPermissions]=useState({edit:false,delete:false,post:false});
 useEffect(()=>{let live=true;setLoading(true);setError('');void(async()=>{try{
  if(context){
   const rows=[...(context.invoices as Invoice[])].sort((a,b)=>b.order_date.localeCompare(a.order_date)||a.order_no.localeCompare(b.order_no)||a.id.localeCompare(b.id));
   if(live){setInvoices(rows);setDraftPermissions(context.draft_permissions?.[side]??{edit:false,delete:false,post:false});setSelected(current=>rows.some(row=>row.id===current)?current:rows[0]?.id??'');}return;
  }
  const links=await supabase.from(side==='customer'?'transport_customer_document_trips':'transport_supplier_document_rents').select('document_id').eq('trip_id',trip.id).eq('is_adjustment',false);
  if(links.error)throw links.error;
  const ids=[...new Set((links.data||[]).map(x=>x.document_id))];
  if(!ids.length){if(live)setInvoices([]);return;}
  const docs=await supabase.from(side==='customer'?'transport_customer_documents':'transport_supplier_documents').select(side==='customer'?'id,sales_order_id':'id,purchase_order_id').in('id',ids);
  if(docs.error)throw docs.error;
  if(docs.data?.length!==ids.length)throw new Error('The linked invoices could not be read in this workspace.');
  const orderKey=side==='customer'?'sales_order_id':'purchase_order_id';
  const orderIds=(docs.data as unknown as Record<string,string>[]).map(x=>x[orderKey]);
  const [orders,permission]=await Promise.all([
   supabase.from(side==='customer'?'sales_orders':'purchase_orders').select('id,order_no,order_date,status,total').in('id',orderIds),
   supabase.rpc('transport_draft_invoice_permissions'),
  ]);
  if(orders.error)throw orders.error;if(permission.error)throw permission.error;
  if(orders.data?.length!==orderIds.length)throw new Error('The original invoice records could not be verified.');
  const rows=(orders.data||[]).map(order=>({...order,document_id:(docs.data as unknown as Record<string,string>[]).find(doc=>doc[orderKey]===order.id)!.id})) as Invoice[];
  if(live){setInvoices(rows);setDraftPermissions(permission.data?.[side]??{edit:false,delete:false,post:false});setSelected(current=>rows.some(row=>row.id===current)?current:rows[0].id);}
 }catch(e:unknown){if(live)setError(String((e as {message?:string})?.message||'Could not load the linked invoice.'));}finally{if(live)setLoading(false)}})();return()=>{live=false};},[side,trip.id,revision,context]);
 async function changed(){await onChanged();setRevision(value=>value+1)}
 const invoice=invoices.find(row=>row.id===selected);
 async function post(){if(!invoice||busy)return;setBusy(true);setError('');try{
  const result=await supabase.rpc(side==='customer'?'transport_post_customer_draft':'transport_post_supplier_draft',{p_document_id:invoice.document_id});
  if(result.error)throw result.error;await changed();
 }catch(e:unknown){setError(String((e as {message?:string})?.message||'Could not post this draft.'));}finally{setBusy(false)}}
 async function remove(){if(!invoice||busy||!window.confirm(`Delete Draft invoice ${invoice.order_no}? Its invoice links will be removed; Trip records will remain. This cannot be undone.`))return;
  setBusy(true);setError('');try{const result=await supabase.rpc('transport_delete_register_draft_invoice',{p_side:side,p_document_id:invoice.document_id});if(result.error)throw result.error;await onChanged();onClose();}
  catch(e:unknown){setError(String((e as {message?:string})?.message||'Could not delete this draft.'));}finally{setBusy(false)}
 }
 if(!loading&&!error&&!invoices.length)return side==='customer'?<TransportInvoiceNumber trip={trip} onClose={onClose} onChanged={onChanged}/>:<TransportBulkSupplierRent compact initialTripId={trip.id} initialSupplierName={trip.owner_name??undefined} onClose={onClose} onChanged={onChanged}/>;
 return <>
 <TransportDialog onClose={()=>{if(!busy)onClose()}}><section role="dialog" aria-modal="true" aria-label={`${side==='customer'?'Customer':'Supplier'} linked invoice Trip ${trip.trip_no}`} className="w-full max-w-2xl rounded-lg border bg-white p-3 text-xs shadow-xl">
  <h2 className="text-sm font-bold">{side==='customer'?'Customer':'Supplier'} Invoice · Trip {trip.trip_no}</h2>
  {loading&&<p role="status" className="my-3">Loading linked invoice…</p>}
  {error&&<p role="alert" className="my-2 text-red-700">{error}</p>}
  {!loading&&invoice&&<>
   {invoices.length>1&&<label className="mt-2 block">Invoice<select aria-label="Linked invoice" className="input ml-2" value={selected} onChange={e=>setSelected(e.target.value)}>{invoices.map(row=><option key={row.id} value={row.id}>{row.order_no} · {row.status}</option>)}</select></label>}
   <p className="my-3"><strong>{invoice.order_no}</strong> · {invoice.status} · Total {financialNumber(invoice.total)}</p>
   <div className="flex flex-wrap items-center gap-2">
    <a className="btn" href={`/${side==='customer'?'sales':'purchase'}/${invoice.id}`} target="_blank" rel="noreferrer">Review Invoice</a>
    {invoice.status==='draft'&&<>{draftPermissions.edit&&<button className="btn" disabled={busy} onClick={()=>setEditing(true)}>Edit Draft</button>}{draftPermissions.post&&<button className="btn-primary" disabled={busy} onClick={()=>void post()}>Post Invoice</button>}{draftPermissions.delete&&<button className="btn-danger" disabled={busy} onClick={()=>void remove()}>Delete Draft</button>}</>}
    {invoice.status==='posted'&&<TransportPostedInvoiceControls side={side} order={invoice} onSaved={()=>void changed()} onDeleted={async()=>{await onChanged();onClose()}}/>}
   </div>
  </>}
  <div className="mt-3 flex justify-end"><button className="btn" disabled={busy} onClick={onClose}>Close</button></div>
 </section></TransportDialog>
 {editing&&invoice&&<TransportRegisterDraftInvoiceEditor row={{side,document_id:invoice.document_id,order_id:invoice.id,invoice_no:invoice.order_no,invoice_date:invoice.order_date,party_name:'',trip_count:0}} onClose={()=>setEditing(false)} onSaved={changed}/>}
 </>;
}
