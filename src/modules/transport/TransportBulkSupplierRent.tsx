import {useEffect,useMemo,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useAuth} from '@/auth/AuthContext';
import NaviloDateInput from '@/components/NaviloDateInput';
import {financialNumber} from './transportFinancialTypes';

type Row={id:string;trip_no:string;trip_date:string;trip_status?:string|null;financial_status?:string|null;owner_name?:string|null;supplier_rent?:number|null;owner_rent?:number|null;billed_supplier_net?:number|null};
type LegacyRent={id:string;rent_state?:string|null;rent_finalized_at?:string|null};
type Supplier={id:string;name:string};
type Rent={id:string;trip_id:string;supplier_id:string;amount:number;state?:string;finalized_amount_snapshot?:number|null};
type Account={id:string;name:string;type:string};

export default function TransportBulkSupplierRent({onClose,onChanged}:{onClose:()=>void;onChanged:()=>Promise<void>}){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const [rows,setRows]=useState<Row[]>([]),[legacyRents,setLegacyRents]=useState<LegacyRent[]>([]),[suppliers,setSuppliers]=useState<Supplier[]>([]),[rents,setRents]=useState<Rent[]>([]),[accounts,setAccounts]=useState<Account[]>([]);
 const [supplier,setSupplier]=useState(''),[tripStatus,setTripStatus]=useState(''),[search,setSearch]=useState(''),[selected,setSelected]=useState<string[]>([]),[amounts,setAmounts]=useState<Record<string,string>>({});
 const [account,setAccount]=useState(''),[date,setDate]=useState(new Date().toISOString().slice(0,10)),[reason,setReason]=useState('Bulk supplier rent'),[withTax,setWithTax]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function load(){
  const [rr,lr,ss,rt,aa]=await Promise.all([
   supabase.rpc('transport_financial_register_page',{p_limit:1000,p_offset:0}),
   supabase.from('transport_trips').select('id,rent_state,rent_finalized_at').eq('company_id',activeCompany?.company_id).eq('business_unit_id',activeBusinessUnit?.business_unit_id),
   supabase.from('suppliers').select('id,name').eq('company_id',activeCompany?.company_id).eq('is_active',true).order('name'),
   supabase.from('transport_trip_supplier_rents').select('id,trip_id,supplier_id,amount,state,finalized_amount_snapshot').eq('company_id',activeCompany?.company_id).eq('business_unit_id',activeBusinessUnit?.business_unit_id),
   supabase.from('chart_of_accounts').select('id,name,type').eq('company_id',activeCompany?.company_id).eq('is_active',true).eq('type','expense').order('name')
  ]);
  const e=rr.error||lr.error||ss.error||rt.error||aa.error;if(e)throw e;
  setRows((rr.data??[]) as Row[]);setLegacyRents((lr.data??[]) as LegacyRent[]);setSuppliers((ss.data??[]) as Supplier[]);setRents((rt.data??[]) as Rent[]);setAccounts((aa.data??[]) as Account[]);
 }
 useEffect(()=>{void load().catch(e=>setError(e.message))},[activeCompany?.company_id,activeBusinessUnit?.business_unit_id]);
 const existing=useMemo(()=>new Map(rents.map(r=>[r.trip_id,r])),[rents]);
 const legacyBlockedTripIds=useMemo(()=>new Set(legacyRents.filter(r=>r.rent_state==='finalized'||!!r.rent_finalized_at).map(r=>r.id)),[legacyRents]);
 const postedTripIds=useMemo(()=>new Set(rows.filter(r=>Number(r.billed_supplier_net??0)>0).map(r=>r.id)),[rows]);
 const unavailableTripIds=useMemo(()=>new Set([...existing.keys(),...postedTripIds,...legacyBlockedTripIds]),[existing,postedTripIds]);
 const supplierName=suppliers.find(s=>s.id===supplier)?.name??'';
 const tripStatuses=useMemo(()=>[...new Set(rows.map(r=>r.trip_status||r.financial_status).filter((v):v is string=>!!v))].sort(),[rows]);
 const visible=rows.filter(r=>!supplierName||r.owner_name===supplierName||existing.get(r.id)?.supplier_id===supplier).filter(r=>!tripStatus||(r.trip_status||r.financial_status)===tripStatus).filter(r=>!search||r.trip_no.toLowerCase().includes(search.toLowerCase()));
 function toggle(id:string,on:boolean){setSelected(v=>on?[...new Set([...v,id])]:v.filter(x=>x!==id));}
 function selectShown(){const ids=visible.filter(r=>!unavailableTripIds.has(r.id)).map(r=>r.id);setSelected(ids);setAmounts(v=>({...v,...Object.fromEntries(ids.map(id=>{const r=rows.find(x=>x.id===id)!;return [id,String(r.supplier_rent??r.owner_rent??'')]}))}));}
 async function post(){
  if(!supplier||!account||!selected.length||!reason.trim())return;
  setBusy(true);setError('');setMessage('');
  let done=0,skipped=0;
  try{
   for(const id of selected){
    if(unavailableTripIds.has(id)){skipped++;continue;}
    const row=rows.find(r=>r.id===id);const raw=amounts[id]??String(row?.supplier_rent??row?.owner_rent??'');const amount=Number(raw);if(!(amount>0))throw new Error(`Enter a valid rent for ${row?.trip_no}`);
    const add=await supabase.rpc('transport_add_supplier_rent',{p_trip_id:id,p_supplier_id:supplier,p_amount:amount,p_reason:reason.trim()});if(add.error)throw add.error;
    const bill=await supabase.rpc('transport_post_supplier_bill',{p_rent_id:add.data,p_date:date,p_cost_account_id:account,p_with_tax:withTax,p_reference:'Bulk supplier rent'});if(bill.error)throw bill.error;
    done++;
   }
   await load();await onChanged();setSelected([]);setAmounts({});setMessage(`${done} trip rent(s) finalized and posted to canonical Accounts Payable.${skipped?` ${skipped} legacy/already-posted trip(s) skipped safely.`:''}`);
  }catch(e){const detail=e&&typeof e==='object'&&'message' in e?String((e as {message?:unknown}).message):String(e||'Bulk rent failed');setError(`${detail} · ${done} trip(s) completed before this error; completed trips will not be repeated.`)}
  finally{setBusy(false)}
 }
 return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-3"><section className="max-h-[94vh] w-full max-w-6xl overflow-auto rounded-lg bg-white p-4 text-xs shadow-xl">
  <div className="flex items-center justify-between"><div><h2 className="text-sm font-bold">Bulk Supplier Rent</h2><p className="text-slate-500">Select supplier → enter/paste trip rents → Finalize & Post once. Each trip still creates its own canonical supplier bill.</p></div><button className="btn" disabled={busy} onClick={onClose}>Close</button></div>
  {error&&<p className="my-2 text-red-700">{error}</p>}{message&&<p className="my-2 text-emerald-700">{message}</p>}
  <div className="my-3 flex flex-wrap items-end gap-2 rounded border bg-slate-50 p-2">
   <label>Supplier<select className="input" value={supplier} onChange={e=>{setSupplier(e.target.value);setSelected([]);setAmounts({})}}><option value="">Select supplier</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <label>Expense account<select className="input" value={account} onChange={e=>setAccount(e.target.value)}><option value="">Select account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
   <label>Date<NaviloDateInput className="input" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
   <label>Reason<input className="input" value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <label className="pb-1"><input type="checkbox" checked={withTax} onChange={e=>setWithTax(e.target.checked)}/> With VAT</label>
   <label>Trip Status<select className="input" value={tripStatus} onChange={e=>{setTripStatus(e.target.value);setSelected([])}}><option value="">All Statuses</option>{tripStatuses.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
   <label>Search Trip<input className="input" value={search} onChange={e=>setSearch(e.target.value)}/></label>
   <button className="btn" disabled={!supplier||busy} onClick={selectShown}>Select All Unposted</button>
  </div>
  <div className="max-h-[55vh] overflow-auto border"><table className="w-full whitespace-nowrap text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">Select</th><th>Trip</th><th>Date</th><th>Trip Status</th><th>Owner / Supplier</th><th>Rent</th><th>Rent / Post Status</th></tr></thead><tbody>{visible.map(r=>{const ex=existing.get(r.id);const posted=postedTripIds.has(r.id);const legacyBlocked=legacyBlockedTripIds.has(r.id)&&!ex&&!posted;const locked=!!ex||posted||legacyBlocked;return <tr key={r.id} className="border-t"><td className="p-2"><input type="checkbox" disabled={locked||busy} checked={selected.includes(r.id)} onChange={e=>toggle(r.id,e.target.checked)}/></td><td className="font-semibold">{r.trip_no}</td><td>{r.trip_date}</td><td><span className="rounded bg-slate-100 px-2 py-1 font-medium">{r.trip_status||r.financial_status||'—'}</span></td><td>{r.owner_name||supplierName||'—'}</td><td><input className="input w-28" type="number" min="0.01" step="0.01" disabled={locked||busy} value={ex?String(ex.finalized_amount_snapshot??ex.amount):posted?String(r.billed_supplier_net??''):amounts[r.id]??String(r.supplier_rent??r.owner_rent??'')} onChange={e=>setAmounts(v=>({...v,[r.id]:e.target.value}))}/></td><td>{legacyBlocked?<span className="font-medium text-red-700">Legacy Rent — Correction Required</span>:locked?<span className="text-emerald-700">Already posted {financialNumber(ex?.finalized_amount_snapshot??ex?.amount??r.billed_supplier_net)}</span>:<span className="text-amber-700">Ready</span>}</td></tr>})}</tbody></table></div>
  <div className="mt-3 flex items-center justify-between"><strong>{selected.length} trip(s) selected</strong><button className="btn-primary" disabled={busy||!supplier||!account||!selected.length||!reason.trim()} onClick={()=>void post()}>{busy?'Posting…':'Finalize & Post Selected'}</button></div>
 </section></div>;
}
