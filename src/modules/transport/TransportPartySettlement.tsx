import {useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {financialNumber} from './transportFinancialTypes';
import {fifoPreview,reviewedAllocations,type PartyDocument,type PartySide} from './transportPartyReporting';
type CashAccount={id:string;name:string;detail_type:string};
export default function TransportPartySettlement({side,party,documents,accounts,onPosted,onBusyChange}:{side:PartySide;party:string;documents:PartyDocument[];accounts:CashAccount[];onPosted:()=>Promise<void>;onBusyChange:(busy:boolean)=>void}){
 const [allowed,setAllowed]=useState(false);const [amounts,setAmounts]=useState<Record<string,string>>({});
 const [account,setAccount]=useState('');const [date,setDate]=useState(new Date().toISOString().slice(0,10));
 const [reference,setReference]=useState('');const [fifo,setFifo]=useState('');const [search,setSearch]=useState('');
 const [review,setReview]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const [result,setResult]=useState<{message:string;journals:string[]}|null>(null);const request=useRef<string|null>(null);const submitting=useRef(false);
 useEffect(()=>{let live=true;void supabase.rpc('transport_finance_allowed',{p_action:'settlement'}).then(({data,error})=>{if(live){setAllowed(!error&&data===true);if(error)setError(error.message)}});return()=>{live=false}},[]);
 const eligible=useMemo(()=>documents.filter(d=>d.side===side&&d.party_id===party&&Number(d.current_outstanding_gross)>0),[documents,side,party]);
 const visible=eligible.filter(d=>`${d.trip_no} ${d.order_no}`.toLowerCase().includes(search.toLowerCase()));
 let checked:{allocations:Array<{document_id:string;amount:number}>;total:number}={allocations:[],total:0};let validation='';
 try{checked=reviewedAllocations(documents,side,party,amounts)}catch(e){validation=e instanceof Error?e.message:'Invalid allocation'}
 function changeAmounts(next:Record<string,string>){setAmounts(next);setReview(false);request.current=null;setError('');setResult(null)}
 function changed(){setReview(false);request.current=null;setResult(null)}
 async function post(){
 if(submitting.current||!allowed||!review||!account||!date||validation||!checked.allocations.length)return;
 submitting.current=true;setBusy(true);onBusyChange(true);setError('');
 try{
 request.current??=crypto.randomUUID();
 const accountRow=accounts.find(a=>a.id===account);
 const r=await supabase.rpc('transport_settle_reviewed_documents',{p_request_id:request.current,p_side:side,p_party_id:party,p_date:date,p_account_id:account,
 p_method:accountRow?.detail_type==='Bank Account'?'bank':'cash',p_allocations:checked.allocations,p_reference:reference||null});
 if(r.error)throw r.error;
 const values=r.data?.payments??[r.data];const journals=values.map((v:{journal_entry_id?:string})=>v?.journal_entry_id).filter(Boolean) as string[];
 setResult({message:`Posted ${financialNumber(checked.total)} through canonical ${side==='customer'?'customer receipts':'supplier payments'}.`,journals});
 setAmounts({});setReview(false);request.current=null;
 try{await onPosted()}catch(e){setError(`Payment posted; refresh failed. Refresh reports before another payment. ${e instanceof Error?e.message:''}`)}
 }catch(e){setError(`${e instanceof Error?e.message:'Settlement failed'}. If the connection failed, retry the unchanged reviewed request safely.`)}
 finally{submitting.current=false;setBusy(false);onBusyChange(false)}
 }
 return <fieldset className="my-3 rounded border p-3" disabled={busy}><legend className="font-semibold">Cross-Trip {side==='customer'?'Receipt':'Supplier Payment'} — VAT included</legend>
 <p className="mb-2">One selected party in the active branch. FIFO prepares visible allocations for review; no payment is posted until confirmation. Report date/search filters do not limit this payment list.</p>
 {error&&<p role="alert" className="text-red-700">{error}</p>}{result&&<p role="status" className="text-emerald-700">{result.message} {result.journals.map(id=><a key={id} className="ml-2 underline" href={`/accounting/${id}`}>Voucher</a>)}</p>}
 <div className="my-2 flex flex-wrap items-end gap-2"><label>Payment date<input className="input" type="date" value={date} onChange={e=>{setDate(e.target.value);changed()}}/></label>
 <label>Cash / Bank<select className="input" value={account} onChange={e=>{setAccount(e.target.value);changed()}}><option value="">Select account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
 <label>Payment reference<input className="input" value={reference} onChange={e=>{setReference(e.target.value);changed()}}/></label>
 <label>FIFO amount<input className="input w-28" type="number" step="0.01" min="0.01" value={fifo} onChange={e=>setFifo(e.target.value)}/></label>
 <button className="btn" disabled={!allowed} onClick={()=>{try{changeAmounts(fifoPreview(documents,side,party,fifo))}catch(e){setError(e instanceof Error?e.message:'Invalid FIFO amount')}}}>Prepare FIFO</button>
 <label>Search payable Trips<input className="input" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
 <div className="mb-2 flex gap-2"><button className="btn" disabled={!allowed} onClick={()=>changeAmounts({...amounts,...Object.fromEntries(visible.map(d=>[d.order_id,Number(d.current_outstanding_gross).toFixed(2)]))})}>Select all shown</button><button className="btn" onClick={()=>changeAmounts({})}>Clear allocations</button></div>
 <div className="max-h-64 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th>Select</th><th>Trip</th><th>Bill</th><th>Kind</th><th>Outstanding gross</th><th>Allocate gross</th><th>Remaining after payment</th></tr></thead><tbody>{visible.map(d=><tr key={d.order_id} className="border-t"><td><input aria-label={`Select ${d.order_no}`} type="checkbox" disabled={!allowed} checked={Number(amounts[d.order_id])>0} onChange={e=>{const next={...amounts};if(e.target.checked)next[d.order_id]=Number(d.current_outstanding_gross).toFixed(2);else delete next[d.order_id];changeAmounts(next)}}/></td><td>{d.trip_no}</td><td>{d.order_no}</td><td>{d.kind}</td><td>{financialNumber(d.current_outstanding_gross)}</td><td><input aria-label={`Allocate ${d.order_no}`} className="input w-28" type="number" min="0" max={d.current_outstanding_gross??0} step="0.01" disabled={!allowed} value={amounts[d.order_id]??''} onChange={e=>changeAmounts({...amounts,[d.order_id]:e.target.value})}/></td><td>{financialNumber(Number(d.current_outstanding_gross)-Number(amounts[d.order_id]||0))}</td></tr>)}</tbody></table></div>
 {validation&&<p role="alert" className="text-red-700">{validation}</p>}
 <div className="mt-3 flex gap-3"><strong>Total allocation: {financialNumber(checked.total)}</strong><button className="btn" disabled={!allowed||!account||!date||!!validation||!checked.allocations.length} onClick={()=>{setReview(true);request.current??=crypto.randomUUID()}}>Review allocations</button></div>
 {review&&<div className="mt-2 rounded border border-blue-200 bg-blue-50 p-3"><strong>Confirm {side==='customer'?'receipt':'payment'}: {financialNumber(checked.total)}</strong><p>{date} · {accounts.find(a=>a.id===account)?.name} · {reference||'No reference'}</p>
 <ul>{checked.allocations.map(a=>{const d=documents.find(d=>d.order_id===a.document_id);return <li key={a.document_id}>{d?.trip_no} / {d?.order_no}: {financialNumber(a.amount)}</li>})}</ul>
 <button className="btn-primary mt-2" disabled={!allowed||busy} onClick={()=>void post()}>{busy?'Posting…':'Confirm and post'}</button><button className="btn ml-2" onClick={()=>setReview(false)}>Back to edit</button></div>}
 </fieldset>;
}
