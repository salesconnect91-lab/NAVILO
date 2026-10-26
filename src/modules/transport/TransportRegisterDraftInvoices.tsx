import {useCallback,useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import TransportDialog from './TransportDialog';
import DataTable from '@/components/DataTable';
import {supabase} from '@/lib/supabase';
import {financialNumber} from './transportFinancialTypes';
import TransportRegisterDraftInvoiceEditor from './TransportRegisterDraftInvoiceEditor';

type Side='customer'|'supplier';
type DraftInvoice={side:Side;document_id:string;order_id:string;invoice_no:string;invoice_date:string;party_name:string;trip_count:number;net_amount:number;vat_amount:number};

export default function TransportRegisterDraftInvoices({onClose,onChanged}:{onClose:()=>void;onChanged:()=>Promise<void>}){
 const [rows,setRows]=useState<DraftInvoice[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState(''),[editing,setEditing]=useState<DraftInvoice|null>(null);
 const [permissions,setPermissions]=useState<Record<string,{edit:boolean;delete:boolean;post:boolean}>>({});
 const load=useCallback(async()=>{setLoading(true);setError('');try{const [result,permission]=await Promise.all([supabase.rpc('transport_register_draft_invoice_list'),supabase.rpc('transport_draft_invoice_permissions')]);if(result.error)throw result.error;if(permission.error)throw permission.error;setPermissions(permission.data??{});setRows(Array.isArray(result.data?.rows)?result.data.rows:[])}catch(e:any){setError(e?.message||'Could not load Register Draft invoices.')}finally{setLoading(false)}},[]);
 useEffect(()=>{void load()},[load]);
 async function refreshFromTrips(row:DraftInvoice){if(busy)return;setBusy(row.document_id);setError('');setMessage('');try{const result=await supabase.rpc('transport_refresh_draft_invoice',{p_side:row.side,p_document_id:row.document_id});if(result.error)throw result.error;setMessage(`${row.invoice_no} refreshed from current Register Trips.`);await load()}catch(e:any){setError(e?.message||`Could not refresh ${row.invoice_no}.`)}finally{setBusy('')}}
 async function post(row:DraftInvoice){if(busy)return;setBusy(row.document_id);setError('');setMessage('');try{const result=await supabase.rpc(row.side==='customer'?'transport_post_customer_draft':'transport_post_supplier_draft',{p_document_id:row.document_id});if(result.error)throw result.error;setMessage(`${row.invoice_no} posted.`);await load();await onChanged()}catch(e:any){setError(e?.message||`Could not post ${row.invoice_no}.`)}finally{setBusy('')}}
 async function deleteDraft(row:DraftInvoice){if(busy||!window.confirm(`Delete Draft invoice ${row.invoice_no}? Its linked invoice lines will be removed; the Register Trips will remain.`))return;setBusy(row.document_id);setError('');setMessage('');try{const result=await supabase.rpc('transport_delete_register_draft_invoice',{p_side:row.side,p_document_id:row.document_id});if(result.error)throw result.error;setMessage(`${row.invoice_no} Draft deleted. The Trips remain in Register.`);await load();await onChanged()}catch(e:any){setError(e?.message||`Could not delete Draft ${row.invoice_no}.`)}finally{setBusy('')}}
 return <><TransportDialog onClose={onClose}><section role="dialog" aria-modal="true" aria-label="Register Draft invoices" className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-slate-300 bg-white p-3 text-xs shadow-xl">
  <header className="mb-2 flex items-center justify-between border-b border-slate-200 pb-2"><div><h2 className="text-sm font-bold text-slate-900">Draft Invoices · Transport Register</h2><p className="text-[10px] text-slate-500">Review Draft invoices here; Post is a separate manual action. Cash is without VAT; Credit follows the configured VAT rate.</p></div><button className="btn" disabled={!!busy} onClick={onClose}>Close</button></header>
  {error&&<p role="alert" className="mb-2 rounded border border-red-200 bg-red-50 p-2 text-red-700">{error}</p>}{message&&<p role="status" className="mb-2 rounded border border-emerald-200 bg-emerald-50 p-2 text-emerald-700">{message}</p>}
  <div className="min-h-0 flex-1 overflow-auto rounded border border-slate-200">
   <DataTable columns={[
 {key:"side",label:"Side",render:(r:any)=>r.side==='customer'?'Customer':'Supplier'},
 {key:"invoice_no",label:"Invoice"},
 {key:"invoice_date",label:"Date"},
 {key:"party_name",label:"Customer / Supplier"},
 {key:"trip_count",label:"Trips",render:(r:any)=>Number(r.trip_count)||0},
 {key:"net_amount",label:"Net",render:(r:any)=>financialNumber(Number(r.net_amount)||0),getFilterValue:(r:any)=>Number(r.net_amount)||0},
 {key:"vat_amount",label:"VAT",render:(r:any)=>financialNumber(Number(r.vat_amount)||0),getFilterValue:(r:any)=>Number(r.vat_amount)||0},
 {key:"total",label:"Total",render:(r:any)=>financialNumber((Number(r.net_amount)||0)+(Number(r.vat_amount)||0)),getFilterValue:(r:any)=>(Number(r.net_amount)||0)+(Number(r.vat_amount)||0)},
 {key:"actions",label:"Actions",sortable:false,filterable:false,render:(row:any)=><div className="flex gap-1.5"><button className="btn h-7" disabled={!!busy||loading||!permissions[row.side]?.edit} onClick={()=>setEditing(row)}>Edit Draft</button><button className="btn h-7" disabled={!!busy||loading||!permissions[row.side]?.edit} onClick={()=>void refreshFromTrips(row)}>{busy===row.document_id?'Refreshing…':'Refresh from Trips'}</button><Link className="btn h-7" to={`${row.side==='customer'?'/sales/':'/purchase/'}${encodeURIComponent(row.order_id)}`} target="_blank" rel="noreferrer">Review</Link><button className="btn-primary h-7" disabled={!!busy||loading||!permissions[row.side]?.post} onClick={()=>void post(row)}>{busy===row.document_id?'Working…':'Post Invoice'}</button><button className="btn-danger h-7" disabled={!!busy||loading||!permissions[row.side]?.delete} onClick={()=>void deleteDraft(row)}>{busy===row.document_id?'Deleting…':'Delete Draft'}</button></div>}
 ]} rows={rows.map(row=>({...row,id:`${row.side}-${row.document_id}`}))} loading={loading} emptyMessage="No Draft Transport invoices in this Register."/>
  </div>
  <footer className="mt-2 flex items-center justify-between"><span className="text-[10px] text-slate-500">{rows.length} Draft invoice(s) · No accounting entries exist until Post.</span><button className="btn" disabled={loading||!!busy} onClick={()=>void load()}>Refresh</button></footer>
 </section></TransportDialog>{editing&&<TransportRegisterDraftInvoiceEditor row={editing} onClose={()=>setEditing(null)} onSaved={async()=>{setMessage(`${editing.invoice_no} draft updated in place.`);await load();await onChanged()}}/>}</>
}
