import NaviloSearchableSelect from "@/components/SearchableSelect";
import NaviloDateInput from '@/components/NaviloDateInput';
import {useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {financialNumber} from './transportFinancialTypes';
import {fifoPreview,reviewedAllocations,type PartyDocument,type PartySide} from './transportPartyReporting';
import TransportDialog from './TransportDialog';
type CashAccount={id:string;name:string;detail_type:string};
export default function TransportPartySettlement({side,party,documents,accounts,onPosted,onBusyChange}:{side:PartySide;party:string;documents:PartyDocument[];accounts:CashAccount[];onPosted:()=>Promise<void>;onBusyChange:(busy:boolean)=>void}){
 const [allowed,setAllowed]=useState(false);const [amounts,setAmounts]=useState<Record<string,string>>({});
 // Parent TransportCashSettlement owns the scoped invoice fetch. Do not launch
 // a second identical RPC scan here (especially expensive on large ledgers).
 const [settlementDocuments,setSettlementDocuments]=useState<PartyDocument[]>(documents);const [loadingDocuments,setLoadingDocuments]=useState(false);
 const [invoiceSet,setInvoiceSet]=useState<'all'|'opening'|'native'>('all');
 const [account,setAccount]=useState('');const [date,setDate]=useState(new Date().toISOString().slice(0,10));
 const [reference,setReference]=useState('');const [fifo,setFifo]=useState('');const [search,setSearch]=useState('');
 const [autoScope,setAutoScope]=useState<'all'|'selected'>('all');
 const [review,setReview]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const [result,setResult]=useState<{message:string;journals:string[]}|null>(null);const [viewDocumentId,setViewDocumentId]=useState<string|null>(null);const request=useRef<string|null>(null);const submitting=useRef(false);
 useEffect(()=>{let live=true;void supabase.rpc('transport_finance_allowed',{p_action:'settlement'}).then(({data,error})=>{if(live){setAllowed(!error&&data===true);if(error)setError(error.message)}});return()=>{live=false}},[]);
 useEffect(()=>{
  // A new authoritative snapshot arrives only after the parent completes a
  // successful scoped refresh. All selection and posting validation still use it.
  setSettlementDocuments(documents);
  setLoadingDocuments(false);
  setReview(false);
  request.current=null;
 },[side,party,documents]);
 const eligible=useMemo(()=>settlementDocuments.filter(d=>d.side===side&&d.party_id===party&&Number(d.current_outstanding_gross)>0&&(invoiceSet==='all'||(d.kind==='opening_balance')===(invoiceSet==='opening'))),[settlementDocuments,side,party,invoiceSet]);
 const visible=eligible.filter(d=>`${d.trip_no} ${d.order_no}`.toLowerCase().includes(search.toLowerCase()));
 const viewedDocument=viewDocumentId?settlementDocuments.find(d=>d.order_id===viewDocumentId&&d.side===side&&d.party_id===party):undefined;
 let checked:{allocations:Array<{document_id:string;amount:number}>;total:number}={allocations:[],total:0};let validation='';
 try{checked=reviewedAllocations(settlementDocuments,side,party,amounts);const kinds=new Set(checked.allocations.map(a=>settlementDocuments.find(d=>d.order_id===a.document_id)?.kind==='opening_balance'));if(kinds.size>1)throw new Error('Allocate imported opening invoices and newly issued invoices separately. Choose an invoice set.')}catch(e){validation=e instanceof Error?e.message:'Invalid allocation'}
 function changeAmounts(next:Record<string,string>){setAmounts(next);setReview(false);request.current=null;setError('');setResult(null)}
 function changed(){setReview(false);request.current=null;setResult(null)}
 async function post(){
 if(submitting.current||loadingDocuments||!allowed||!review||!account||!date||validation||!checked.allocations.length)return;
 submitting.current=true;setBusy(true);onBusyChange(true);setError('');
 try{
 request.current??=crypto.randomUUID();
 const accountRow=accounts.find(a=>a.id===account);
 const opening=settlementDocuments.find(d=>d.order_id===checked.allocations[0].document_id)?.kind==='opening_balance';
 const r=await supabase.rpc(opening?'transport_settle_opening_invoices':'transport_settle_reviewed_documents',{p_request_id:request.current,p_side:side,p_party_id:party,p_date:date,p_account_id:account,
 p_method:accountRow?.detail_type==='Bank Account'?'bank':'cash',p_allocations:checked.allocations,p_reference:reference||null});
 if(r.error)throw r.error;
 if(r.data?.success===false)throw new Error(r.data.message||'Settlement failed');
 const values=r.data?.payments??[r.data];const journals=values.map((v:{journal_entry_id?:string})=>v?.journal_entry_id).filter(Boolean) as string[];
 setResult({message:`Posted ${financialNumber(checked.total)} through canonical ${side==='customer'?'customer receipts':'supplier payments'}.`,journals});
 setAmounts({});setReview(false);request.current=null;
 try{
  // Only the parent refreshes both native and imported invoices, once.
  // Disable further allocation until it supplies the next valid snapshot.
  setLoadingDocuments(true);
  await onPosted();
 }catch(e){
  setSettlementDocuments([]);
  setError(`Payment posted; refresh failed. Refresh reports before another payment. ${e instanceof Error?e.message:''}`);
 }
 }catch(e){setError(`${e&&typeof e==='object'&&'message' in e?String(e.message):'Settlement failed'}. If the connection failed, retry the unchanged reviewed request safely.`)}
 finally{submitting.current=false;setBusy(false);onBusyChange(false)}
 }
 return <fieldset className="my-3 min-w-0 max-w-full overflow-hidden rounded border p-3" disabled={busy||loadingDocuments}><legend className="font-semibold">Cross-Trip {side==='customer'?'Receipt':'Supplier Payment'} — Bill allocation</legend>
 <p className="mb-2">One selected party in the active branch. Auto Allocate prepares oldest invoices first for review; no payment is posted until confirmation. Report date/search filters do not limit this payment list.</p>
 {loadingDocuments&&<p role="status">Loading current invoice balances…</p>}
 {settlementDocuments.some(d=>d.kind==='opening_balance')&&<p className="mb-2 text-slate-600">Imported invoices retain original references and settled amounts. Their displayed date is the opening balance date; original issue dates were not supplied. New receipts/payments reduce the posted receivable/payable only.</p>}
 {settlementDocuments.some(d=>d.kind==='opening_balance')&&settlementDocuments.some(d=>d.kind!=='opening_balance')&&<label>Invoice set<NaviloSearchableSelect nativeCompatibility preserveLabel className="input" value={invoiceSet} onChange={e=>{setInvoiceSet(e.target.value as typeof invoiceSet);changeAmounts({})}}><option value="all">All invoices</option><option value="opening">Imported opening invoices</option><option value="native">Newly issued invoices</option></NaviloSearchableSelect></label>}
 {error&&<p role="alert" className="text-red-700">{error}</p>}{result&&<p role="status" className="text-emerald-700">{result.message} {result.journals.map(id=><a key={id} className="ml-2 underline" href={`/accounting/${id}`}>Voucher</a>)}</p>}
 <div className="my-2 flex min-w-0 flex-wrap items-end gap-2 [&>label]:min-w-0 [&>label]:max-w-full [&>label]:flex-1 [&>label]:basis-[180px] [&>label>input]:max-w-full"><label>Payment date<NaviloDateInput className="input" type="date" value={date} onChange={e=>{setDate(e.target.value);changed()}}/></label>
 <label>Cash / Bank<NaviloSearchableSelect nativeCompatibility preserveLabel className="input" value={account} onChange={e=>{setAccount(e.target.value);changed()}}><option value="">Select account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</NaviloSearchableSelect></label>
 <label>Payment reference<input className="input" value={reference} onChange={e=>{setReference(e.target.value);changed()}}/></label>
 <label>Amount to allocate<input className="input w-28" type="number" step="0.01" min="0.01" value={fifo} onChange={e=>setFifo(e.target.value)}/></label>
 <label>Auto allocation scope<NaviloSearchableSelect nativeCompatibility preserveLabel className="input" value={autoScope} onChange={e=>setAutoScope(e.target.value as 'all'|'selected')}><option value="all">All open invoices</option><option value="selected">Selected invoices only</option></NaviloSearchableSelect></label>
 <button type="button" className="btn" disabled={!allowed} onClick={()=>{try{changeAmounts(fifoPreview(autoScope==='selected'?eligible.filter(d=>Object.prototype.hasOwnProperty.call(amounts,d.order_id)):eligible,side,party,fifo))}catch(e){setError(e instanceof Error?e.message:'Invalid allocation amount')}}}>Auto Allocate</button>
 <label>Search Invoice No. / Trip No.<input className="input" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
 <div className="mb-2 flex gap-2"><button className="btn" disabled={!allowed} onClick={()=>changeAmounts({...amounts,...Object.fromEntries(visible.map(d=>[d.order_id,Number(d.current_outstanding_gross).toFixed(2)]))})}>Select all shown</button><button className="btn" onClick={()=>changeAmounts({})}>Clear allocations</button></div>
 <div className="max-h-64 w-full min-w-0 max-w-full overflow-auto"><table className="min-w-[850px] w-full text-left text-xs"><thead><tr><th>Select</th><th>Trip</th><th>Bill</th><th>Kind</th><th>Outstanding gross</th><th>Allocate gross</th><th>Remaining after payment</th><th>View / Open</th></tr></thead><tbody>{visible.map(d=><tr key={d.order_id} className="border-t"><td><input aria-label={`Select ${d.order_no}`} type="checkbox" disabled={!allowed} checked={Number(amounts[d.order_id])>0} onChange={e=>{const next={...amounts};if(e.target.checked)next[d.order_id]=Number(d.current_outstanding_gross).toFixed(2);else delete next[d.order_id];changeAmounts(next)}}/></td><td>{d.trip_no}</td><td>{d.order_no}</td><td>{d.kind}</td><td>{financialNumber(d.current_outstanding_gross)}</td><td><input aria-label={`Allocate ${d.order_no}`} className="input w-28" type="number" min="0" max={d.current_outstanding_gross??0} step="0.01" disabled={!allowed} value={amounts[d.order_id]??''} onChange={e=>changeAmounts({...amounts,[d.order_id]:e.target.value})}/></td><td>{financialNumber(Number(d.current_outstanding_gross)-Number(amounts[d.order_id]||0))}</td><td><button type="button" className="btn" aria-label={`View ${d.order_no}`} onClick={()=>setViewDocumentId(d.order_id)}>View</button></td></tr>)}</tbody></table></div>
 {viewedDocument&&<TransportDialog onClose={()=>setViewDocumentId(null)} onClick={e=>{if(e.target===e.currentTarget)setViewDocumentId(null)}}><section role="dialog" aria-modal="true" aria-label="Allocation invoice details" className="w-full max-w-lg max-h-[85vh] overflow-auto rounded-xl border bg-white p-4 shadow-xl"><div className="mb-3 flex items-center justify-between"><h4 className="text-base font-semibold">Invoice / allocation details</h4><button type="button" className="btn" onClick={()=>setViewDocumentId(null)}>Close</button></div><dl className="grid grid-cols-2 gap-3 text-sm"><div><dt>Trip</dt><dd className="font-semibold">{viewedDocument.trip_no||'—'}</dd></div><div><dt>Bill / Invoice</dt><dd className="font-semibold">{viewedDocument.order_no}</dd></div><div><dt>Date</dt><dd>{viewedDocument.order_date}</dd></div><div><dt>Type</dt><dd>{viewedDocument.kind}</dd></div><div><dt>Original gross</dt><dd>{financialNumber(viewedDocument.original_gross)}</dd></div><div><dt>Current outstanding</dt><dd>{financialNumber(viewedDocument.current_outstanding_gross)}</dd></div><div><dt>Allocated in this draft</dt><dd>{financialNumber(Number(amounts[viewedDocument.order_id]||0))}</dd></div><div><dt>Balance after draft</dt><dd>{financialNumber(Number(viewedDocument.current_outstanding_gross)-Number(amounts[viewedDocument.order_id]||0))}</dd></div></dl><div className="mt-4 flex flex-wrap gap-2">{viewedDocument.kind!=='opening_balance'&&<a className="btn" target="_blank" rel="noopener noreferrer" href={`/${side==='customer'?'sales':'purchase'}/${encodeURIComponent(viewedDocument.order_id)}`}>Open {side==='customer'?'customer':'supplier'} invoice ↗</a>}{viewedDocument.journal_entry_id&&<a className="btn" target="_blank" rel="noopener noreferrer" href={`/accounting/${encodeURIComponent(viewedDocument.journal_entry_id)}`}>Open journal voucher ↗</a>}</div></section></TransportDialog>}
 {validation&&<p role="alert" className="text-red-700">{validation}</p>}
 <div className="mt-3 flex gap-3"><strong>Total allocation: {financialNumber(checked.total)}</strong><button className="btn" disabled={!allowed||!account||!date||!!validation||!checked.allocations.length} onClick={()=>{setReview(true);request.current??=crypto.randomUUID()}}>Review allocations</button></div>
 {review&&<div className="mt-2 rounded border border-blue-200 bg-blue-50 p-3"><strong>Confirm {side==='customer'?'receipt':'payment'}: {financialNumber(checked.total)}</strong><p>{date} · {accounts.find(a=>a.id===account)?.name} · {reference||'No reference'}</p>
 <ul>{checked.allocations.map(a=>{const d=settlementDocuments.find(d=>d.order_id===a.document_id);return <li key={a.document_id}>{d?.trip_no} / {d?.order_no}: {financialNumber(a.amount)}</li>})}</ul>
 <button className="btn-primary mt-2" disabled={!allowed||busy} onClick={()=>void post()}>{busy?'Posting…':'Confirm and post'}</button><button className="btn ml-2" onClick={()=>setReview(false)}>Back to edit</button></div>}
 </fieldset>;
}
