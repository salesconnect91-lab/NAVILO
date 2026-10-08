import NaviloSearchableSelect from "@/components/SearchableSelect";
import NaviloDateInput from '@/components/NaviloDateInput';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import {fetchAllPages} from '@/lib/fetchAllPages';
import {financialNumber} from './transportFinancialTypes';
type Side='customer'|'supplier';
type Advance={journal_entry_id:string;side:Side;party_id:string;entry_no:string;entry_date:string;amount:number;allocated:number;available:number};
type Document={side:Side;party_id:string;order_id:string;order_no:string;trip_no:string;current_outstanding_gross:number};
export default function TransportAdvanceOperations({onChanged}:{onChanged:()=>Promise<void>}){
 const {activeCompany,activeBusinessUnit}=useAuth();const company=activeCompany?.company_id;const unit=activeBusinessUnit?.business_unit_id;
 const [side,setSide]=useState<Side>('customer');const [operation,setOperation]=useState<'record'|'allocate'>('record');
 const [customers,setCustomers]=useState<Array<{id:string;name:string}>>([]);const [suppliers,setSuppliers]=useState<Array<{id:string;name:string}>>([]);
 const [advances,setAdvances]=useState<Advance[]>([]);const [documents,setDocuments]=useState<Document[]>([]);const [accounts,setAccounts]=useState<Array<{id:string;name:string;detail_type:string}>>([]);
 const [party,setParty]=useState('');const [source,setSource]=useState('');const [document,setDocument]=useState('');const [account,setAccount]=useState('');
 const [amount,setAmount]=useState('');const [date,setDate]=useState(new Date().toISOString().slice(0,10));const [reference,setReference]=useState('');
 const [allowed,setAllowed]=useState(false);const [busy,setBusy]=useState(false);const [loading,setLoading]=useState(false);const [review,setReview]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('');
 const request=useRef<{body:string;id:string}|null>(null);const generation=useRef(0);
 const load=useCallback(async()=>{if(!company||!unit)return;const token=++generation.current;setLoading(true);try{
 const [c,s,a,d,cash,p]=await Promise.all([
 fetchAllPages<{id:string;name:string}>((start,end)=>supabase.from('customers').select('id,name').eq('company_id',company).eq('is_active',true).order('id').range(start,end)),
 fetchAllPages<{id:string;name:string}>((start,end)=>supabase.from('suppliers').select('id,name').eq('company_id',company).eq('is_active',true).order('id').range(start,end)),
 fetchAllPages<Advance>((start,end)=>supabase.from('transport_party_advances').select('*').order('journal_entry_id').range(start,end)),
 fetchAllPages<Document>((start,end)=>supabase.from('transport_party_documents').select('side,party_id,order_id,order_no,trip_no,current_outstanding_gross').order('side').order('order_id').range(start,end)),
 fetchAllPages<{id:string;name:string;detail_type:string}>((start,end)=>supabase.from('chart_of_accounts').select('id,name,detail_type').eq('company_id',company).eq('is_active',true).eq('is_group',false).in('detail_type',['Cash on Hand','Bank Account']).order('id').range(start,end)),
 supabase.rpc('transport_finance_allowed',{p_action:'settlement'})]);
 if(p.error)throw p.error;if(token===generation.current){setCustomers(c);setSuppliers(s);setAdvances(a);setDocuments(d);setAccounts(cash);setAllowed(p.data===true)}
 }finally{if(token===generation.current)setLoading(false)}},[company,unit]);
 useEffect(()=>{setAllowed(false);setParty('');setSource('');setDocument('');setAccount('');setAmount('');setReview(false);request.current=null;void load().catch(e=>setError(e.message));return()=>{generation.current++}},[load]);
 const parties=side==='customer'?customers:suppliers;const available=advances.filter(a=>a.side===side&&a.party_id===party);const bills=documents.filter(d=>d.side===side&&d.party_id===party&&Number(d.current_outstanding_gross)>0.005);
 const selected=available.find(a=>a.journal_entry_id===source);const bill=bills.find(d=>d.order_id===document);
 const valid=allowed&&!busy&&!loading&&!!party&&!!date&&/^\d+(\.\d{1,2})?$/.test(amount)&&Number(amount)>0&&(operation==='record'?!!account:!!selected&&!!bill&&Number(amount)<=Number(selected.available)+0.005&&Number(amount)<=Number(bill.current_outstanding_gross)+0.005);
 async function post(){if(!valid||!review)return;setBusy(true);setError('');setMessage('');try{
 const args={p_side:side,p_operation:operation,p_party_id:party,p_date:date,p_amount:Number(amount),p_account_id:operation==='record'?account:null,p_method:accounts.find(a=>a.id===account)?.detail_type==='Bank Account'?'bank':'cash',p_source_id:operation==='allocate'?source:null,p_order_id:operation==='allocate'?document:null,p_reference:reference||null};
 const body=JSON.stringify(args);if(request.current?.body!==body)request.current={body,id:crypto.randomUUID()};
 const r=await supabase.rpc('transport_manage_advance',{...args,p_request_id:request.current.id});if(r.error)throw r.error;
 await load();await onChanged();request.current=null;setAmount('');setSource('');setDocument('');setReview(false);setMessage(operation==='record'?'Advance saved. It remains separate from Trip balances until allocated.':'Existing advance allocated; no second cash entry was posted.');
 }catch(e:any){setError(e?.message||'Unable to save advance')}finally{setBusy(false)}}
 return <section aria-label="Transport advances" className="my-3 rounded border p-3 text-xs">
 <h3 className="font-semibold">Advances / Unallocated Money</h3><p className="my-2">Current Company / Business Unit / branch · company base currency. Record money before a bill, then apply it to a Trip bill. Trip balances and the complete party ledger remain separate.</p>
 {error&&<p role="alert" className="my-2 text-red-700">{error}</p>}{message&&<p role="status" className="my-2 text-emerald-700">{message}</p>}{loading&&<p role="status">Loading available advances…</p>}
 <fieldset disabled={busy||loading} onChange={()=>setReview(false)} className="flex flex-wrap items-end gap-2">
 <label>Advance side<NaviloSearchableSelect nativeCompatibility preserveLabel className="input" value={side} onChange={e=>{setSide(e.target.value as Side);setParty('');setSource('');setDocument('')}}><option value="customer">Customer</option><option value="supplier">Supplier / Owner</option></NaviloSearchableSelect></label>
 <label>Advance party<NaviloSearchableSelect nativeCompatibility preserveLabel className="input" value={party} onChange={e=>{setParty(e.target.value);setSource('');setDocument('')}}><option value="">Select party</option>{parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</NaviloSearchableSelect></label>
 <label>Action<NaviloSearchableSelect nativeCompatibility preserveLabel className="input" value={operation} onChange={e=>setOperation(e.target.value as 'record'|'allocate')}><option value="record">{side==='customer'?'Receive advance':'Pay advance'}</option><option value="allocate">Apply existing advance to Trip</option></NaviloSearchableSelect></label>
 {operation==='record'?<label>Advance Cash / Bank<NaviloSearchableSelect nativeCompatibility preserveLabel className="input" value={account} onChange={e=>setAccount(e.target.value)}><option value="">Select account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</NaviloSearchableSelect></label>:<><label>Existing advance<NaviloSearchableSelect nativeCompatibility preserveLabel className="input" value={source} onChange={e=>setSource(e.target.value)}><option value="">Select voucher</option>{available.map(a=><option key={a.journal_entry_id} value={a.journal_entry_id}>{a.entry_no} · available {financialNumber(a.available)}</option>)}</NaviloSearchableSelect></label><label>Trip bill<NaviloSearchableSelect nativeCompatibility preserveLabel className="input" value={document} onChange={e=>setDocument(e.target.value)}><option value="">Select bill</option>{bills.map(d=><option key={d.order_id} value={d.order_id}>{d.trip_no} · {d.order_no} · due {financialNumber(d.current_outstanding_gross)}</option>)}</NaviloSearchableSelect></label></>}
 <label>Advance amount<input className="input w-28" type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label><label>Advance date<NaviloDateInput className="input" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Advance reference<input className="input" value={reference} onChange={e=>setReference(e.target.value)}/></label>
 <button className="btn" disabled={!valid} onClick={()=>setReview(true)}>Review advance</button></fieldset>
 {review&&<div className="my-2 rounded border bg-blue-50 p-2"><p>{operation==='record'?(side==='customer'?'Receive':'Pay'):'Allocate existing'} {financialNumber(amount)} · {parties.find(p=>p.id===party)?.name} · {date}{bill?` · ${bill.trip_no} / ${bill.order_no}`:''}</p><button className="btn-primary" disabled={!valid} onClick={()=>void post()}>Confirm advance</button></div>}
 {party&&<div className="mt-3 max-h-48 overflow-auto"><table className="w-full text-left"><thead><tr><th>Date</th><th>Voucher</th><th>Original money</th><th>Allocated</th><th>Available</th></tr></thead><tbody>{available.map(a=><tr key={a.journal_entry_id} className="border-t"><td>{a.entry_date}</td><td><a className="underline" href={`/accounting/${a.journal_entry_id}`}>{a.entry_no}</a></td><td>{financialNumber(a.amount)}</td><td>{financialNumber(a.allocated)}</td><td>{financialNumber(a.available)}</td></tr>)}</tbody></table></div>}
 <p className="mt-2"><a className="text-blue-700 underline" href="/accounting/payment-reversals">Controlled receipt / payment reversals</a> · Statements and complete party balances are available above.</p>
 </section>;
}
