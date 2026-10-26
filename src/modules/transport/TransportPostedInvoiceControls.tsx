import TransportReasonSelect from './TransportReasonSelect';
import {useEffect,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {supabase} from '@/lib/supabase';
import TransportDialog from './TransportDialog';

type Props={side:'customer'|'supplier';order:{id:string;order_no:string;order_date:string};onSaved?:()=>void;onDeleted?:()=>void|Promise<void>};
export default function TransportPostedInvoiceControls({side,order,onDeleted}:Props){
 const navigate=useNavigate();
 const [documentId,setDocumentId]=useState<string|null>(null),[allowed,setAllowed]=useState(false);
 const [deleting,setDeleting]=useState(false),[busy,setBusy]=useState(false);
 const [reason,setReason]=useState(''),[error,setError]=useState('');
 useEffect(()=>{let live=true;setAllowed(false);setDocumentId(null);
  void Promise.all([
   supabase.rpc('transport_posted_invoice_admin_access'),
   supabase.from(side==='customer'?'transport_customer_documents':'transport_supplier_documents')
    .select('id').eq(side==='customer'?'sales_order_id':'purchase_order_id',order.id).maybeSingle(),
  ]).then(([access,document])=>{if(live&&!access.error&&!document.error&&access.data===true&&document.data?.id){setAllowed(true);setDocumentId(document.data.id);}})
   .catch(()=>{if(live)setAllowed(false)});
  return()=>{live=false};
 },[side,order.id]);
 async function remove(){
  if(busy||!allowed||reason.trim().length<10)return;
  if(!window.confirm(`Permanently delete posted invoice ${order.order_no} and its original journal? The Trip records will remain. This cannot be undone.`))return;
  setBusy(true);setError('');
  try{
   const result=await supabase.rpc('transport_admin_delete_posted_invoice',{p_side:side,p_order_id:order.id,p_reason:reason.trim()});
   if(result.error)throw result.error;
   if(result.data?.deleted!==true)throw new Error('The database did not confirm deletion.');
   if(onDeleted)await onDeleted();else navigate('/transport');
  }catch(e:unknown){setError(e instanceof Error?e.message:String((e as {message?:string})?.message||'Could not delete this invoice.'));}
  finally{setBusy(false)}
 }
 if(!allowed||!documentId)return null;
 return <>
  <button type="button" className="btn-danger" onClick={()=>setDeleting(true)}>Delete Posted Invoice</button>
  {deleting&&<TransportDialog onClose={()=>{if(!busy)setDeleting(false)}}><section role="dialog" aria-modal="true" aria-label={`Delete Posted Invoice ${order.order_no}`} className="w-full max-w-lg rounded-lg border bg-white p-4 shadow-xl">
   <h2 className="text-base font-semibold">Permanently delete {order.order_no}</h2>
   <p className="my-2 text-sm">This removes the invoice and its original accounting journal. Trip records remain available for invoicing. An audit snapshot is retained. This cannot be undone.</p>
   <p className="my-2 text-xs text-slate-600">Payment, credit-note, stock and other dependent records must be resolved first. The database checks these before deleting anything.</p>
   {error&&<p role="alert" className="my-2 text-sm text-red-700">{error}</p>}
   <TransportReasonSelect kind="invoice_delete" label="Posted invoice permanent deletion reason" value={reason} onChange={setReason} disabled={busy}/>
   <div className="mt-3 flex justify-end gap-2"><button className="btn" disabled={busy} onClick={()=>setDeleting(false)}>Cancel</button><button className="btn-danger" disabled={busy||reason.trim().length<10} onClick={()=>void remove()}>{busy?'Deleting…':'Permanently Delete'}</button></div>
  </section></TransportDialog>}
 </>;
}
