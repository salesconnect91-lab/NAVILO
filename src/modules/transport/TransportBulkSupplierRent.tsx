import {useEffect,useMemo,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useAuth} from '@/auth/AuthContext';
import NaviloDateInput from '@/components/NaviloDateInput';

import {financialNumber} from './transportFinancialTypes';

type Row={id:string;trip_no:string;trip_date:string;trip_status?:string|null;financial_status?:string|null;customer_name?:string|null;vehicle_no?:string|null;driver_name?:string|null;from_location?:string|null;to_location?:string|null;po_do_job_no?:string|null;owner_name?:string|null;supplier_rent?:number|null;owner_rent?:number|null;billed_supplier_net?:number|null};
type LegacyRent={id:string;rent_state?:string|null;rent_finalized_at?:string|null};
type Supplier={id:string;name:string};
type Rent={id:string;trip_id:string;supplier_id:string;amount:number;state?:string;finalized_amount_snapshot?:number|null};
type Account={id:string;name:string;type:string};
const formatTripDate=(value:string)=>{if(!value)return '—';const [y,m,d]=value.slice(0,10).split('-').map(Number);if(!y||!m||!d)return value;return `${String(d).padStart(2,'0')}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1]}-${String(y).slice(-2)}`};

export default function TransportBulkSupplierRent({onClose,onChanged,initialTripId,initialSupplierName}:{onClose:()=>void;onChanged:()=>Promise<void>;initialTripId?:string;initialSupplierName?:string}){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const [rows,setRows]=useState<Row[]>([]),[legacyRents,setLegacyRents]=useState<LegacyRent[]>([]),[suppliers,setSuppliers]=useState<Supplier[]>([]),[rents,setRents]=useState<Rent[]>([]),[accounts,setAccounts]=useState<Account[]>([]);
 const [supplier,setSupplier]=useState(''),[tripStatus,setTripStatus]=useState(''),[search,setSearch]=useState(''),[columnFilters,setColumnFilters]=useState<Record<string,string>>({}),[selected,setSelected]=useState<string[]>([]),[amounts,setAmounts]=useState<Record<string,string>>({});
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
 useEffect(()=>{if(!initialSupplierName||supplier)return;const match=suppliers.find(s=>s.name===initialSupplierName);if(match)setSupplier(match.id)},[suppliers,initialSupplierName,supplier]);
 useEffect(()=>{if(!initialTripId||!rows.some(r=>r.id===initialTripId)||unavailableTripIds.has(initialTripId))return;setSelected([initialTripId]);const r=rows.find(x=>x.id===initialTripId);setAmounts(v=>({...v,[initialTripId]:v[initialTripId]??String(r?.supplier_rent??r?.owner_rent??'')}))},[initialTripId,rows]);
 const existing=useMemo(()=>new Map(rents.map(r=>[r.trip_id,r])),[rents]);
 const legacyBlockedTripIds=useMemo(()=>new Set(legacyRents.filter(r=>r.rent_state==='finalized'||!!r.rent_finalized_at).map(r=>r.id)),[legacyRents]);
 const postedTripIds=useMemo(()=>new Set(rows.filter(r=>Number(r.billed_supplier_net??0)>0).map(r=>r.id)),[rows]);
 const legacyBlockedOnly=useMemo(()=>new Set([...legacyBlockedTripIds].filter(id=>!existing.has(id)&&!postedTripIds.has(id))),[legacyBlockedTripIds,existing,postedTripIds]);
 const unavailableTripIds=useMemo(()=>new Set([...postedTripIds,...legacyBlockedOnly]),[postedTripIds,legacyBlockedOnly]);
 const supplierName=suppliers.find(s=>s.id===supplier)?.name??'';
 const tripStatuses=useMemo(()=>[...new Set(rows.map(r=>r.trip_status||r.financial_status).filter((v):v is string=>!!v))].sort(),[rows]);
 const filterMatch=(value:unknown,key:string)=>!columnFilters[key]||String(value??'').toLowerCase().includes(columnFilters[key].toLowerCase());
 const rentStatus=(r:Row)=>postedTripIds.has(r.id)?'posted':legacyBlockedOnly.has(r.id)?'legacy correction required':existing.get(r.id)?.state==='finalized'?'finalized ready to post':'pending ready to finalize';
 const visible=rows.filter(r=>!supplierName||r.owner_name===supplierName||existing.get(r.id)?.supplier_id===supplier).filter(r=>!tripStatus||(r.trip_status||r.financial_status)===tripStatus).filter(r=>!search||[r.trip_no,r.customer_name,r.vehicle_no,r.driver_name,r.from_location,r.to_location,r.po_do_job_no].some(v=>String(v??'').toLowerCase().includes(search.toLowerCase()))).filter(r=>filterMatch(r.trip_no,'trip')&&filterMatch(formatTripDate(r.trip_date),'date')&&filterMatch(r.trip_status||r.financial_status,'status')&&filterMatch(r.customer_name,'company')&&filterMatch(`${r.from_location??''} ${r.to_location??''}`,'route')&&filterMatch(r.vehicle_no,'vehicle')&&filterMatch(r.driver_name,'driver')&&filterMatch(r.po_do_job_no,'job')&&filterMatch(r.owner_name||supplierName,'owner')&&filterMatch(existing.get(r.id)?.finalized_amount_snapshot??existing.get(r.id)?.amount??r.supplier_rent??r.owner_rent,'rent')&&filterMatch(rentStatus(r),'rentStatus'));
 function toggle(id:string,on:boolean){setSelected(v=>on?[...new Set([...v,id])]:v.filter(x=>x!==id));}
 function selectShown(){const ids=visible.filter(r=>!unavailableTripIds.has(r.id)).map(r=>r.id);setSelected(ids);}
 async function finalizeSelected(){
  if(!supplier||!selected.length||!reason.trim())return;
  setBusy(true);setError('');setMessage('');let done=0,skipped=0;
  try{
   for(const id of [...selected]){
    if(!selected.includes(id)||unavailableTripIds.has(id)){skipped++;continue;}
    const row=rows.find(r=>r.id===id);const raw=amounts[id]??String(existing.get(id)?.amount??row?.supplier_rent??row?.owner_rent??'');const amount=Number(raw);
    if(!(amount>=0))throw new Error(`Enter a valid rent for ${row?.trip_no}`);
    let rent=existing.get(id);
    if(!rent){const add=await supabase.rpc('transport_add_supplier_rent',{p_trip_id:id,p_supplier_id:supplier,p_amount:amount,p_reason:reason.trim()});if(add.error)throw add.error;rent={id:add.data,trip_id:id,supplier_id:supplier,amount};}
    if(rent.state==='finalized'){skipped++;continue;}
    const fin=await supabase.rpc('transport_finalize_supplier_rent',{p_rent_id:rent.id,p_amount:amount,p_reason:reason.trim()});if(fin.error)throw fin.error;
    done++;
   }
   await load();await onChanged();setSelected([]);setMessage(`${done} trip rent(s) finalized only — no AP bill posted.${skipped?` ${skipped} trip(s) skipped.`:''}`);
  }catch(e){const detail=e&&typeof e==='object'&&'message' in e?String((e as {message?:unknown}).message):String(e||'Bulk rent failed');setError(`${detail} · ${done} trip(s) finalized before this error.`)}finally{setBusy(false)}
 }
 async function postSelected(){
  if(!account||!selected.length)return;
  setBusy(true);setError('');setMessage('');let done=0,skipped=0;
  try{
   for(const id of [...selected]){
    if(!selected.includes(id)||unavailableTripIds.has(id)){skipped++;continue;}
    const rent=existing.get(id);
    if(!rent||rent.state!=='finalized'){skipped++;continue;}
    const bill=await supabase.rpc('transport_post_supplier_bill',{p_rent_id:rent.id,p_date:date,p_cost_account_id:account,p_with_tax:withTax,p_reference:'Bulk supplier rent'});if(bill.error)throw bill.error;done++;
   }
   await load();await onChanged();setSelected([]);setMessage(`${done} finalized rent(s) posted to canonical Accounts Payable.${skipped?` ${skipped} non-finalized/blocked trip(s) skipped.`:''}`);
  }catch(e){const detail=e&&typeof e==='object'&&'message' in e?String((e as {message?:unknown}).message):String(e||'Bulk post failed');setError(`${detail} · ${done} trip(s) posted before this error.`)}finally{setBusy(false)}
 }
 return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-3"><section className="max-h-[88vh] w-full max-w-[1180px] overflow-hidden rounded-lg bg-white p-2 text-[6px] leading-none shadow-xl">
  <div className="flex items-center justify-between"><div><h2 className="text-[8px] font-bold leading-none">Bulk Supplier Rent</h2><p className="text-[6px] leading-none text-slate-500">Select supplier → enter/paste trip rents → Finalize & Post once. Each trip still creates its own canonical supplier bill.</p></div><button className="btn" disabled={busy} onClick={onClose}>Close</button></div>
  {error&&<p className="my-2 text-red-700">{error}</p>}{message&&<p className="my-2 text-emerald-700">{message}</p>}
  <div className="my-2 grid grid-cols-12 items-end gap-1 rounded border bg-slate-50 p-1 text-[6px] leading-none">
   <label className="col-span-2">Supplier<select className="input h-5 px-0.5 text-[7px]" value={supplier} onChange={e=>{setSupplier(e.target.value);setSelected([]);setAmounts({})}}><option value="">Select supplier</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
   <label className="col-span-3">Expense account<select className="input h-5 px-0.5 text-[7px]" value={account} onChange={e=>setAccount(e.target.value)}><option value="">Select account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
   <label className="col-span-2">Date<NaviloDateInput className="input h-5 px-0.5 text-[7px]" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
   <label className="col-span-3">Reason<input className="input h-5 px-0.5 text-[7px]" value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <label className="col-span-2 pb-1"><input type="checkbox" checked={withTax} onChange={e=>setWithTax(e.target.checked)}/> With VAT</label>
   <label className="col-span-2">Trip Status<select className="input h-5 px-0.5 text-[7px]" value={tripStatus} onChange={e=>{setTripStatus(e.target.value);setSelected([])}}><option value="">All Statuses</option>{tripStatuses.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
   <label className="col-span-5">Search Trip / Company / Route / Vehicle<input className="input h-5 px-0.5 text-[7px]" value={search} onChange={e=>setSearch(e.target.value)}/></label>
   <button className="btn col-span-2 h-5 text-[6px]" disabled={!supplier||busy} onClick={selectShown}>Select All Unposted</button>
  </div>
  <div className="max-h-[50vh] overflow-y-auto border"><table className="w-full table-fixed text-left text-[6px] leading-none"><thead className="sticky top-0 bg-slate-100"><tr><th className="w-[3%] p-1">Sel.</th><th className="w-[7%]">Trip<input className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 text-[6px] font-normal leading-none" placeholder="…" value={columnFilters.trip??''} onChange={e=>setColumnFilters(v=>({...v,trip:e.target.value}))}/></th><th className="w-[6%]">Date<input className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 text-[6px] font-normal leading-none" placeholder="…" value={columnFilters.date??''} onChange={e=>setColumnFilters(v=>({...v,date:e.target.value}))}/></th><th className="w-[6%]">Status<input className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 text-[6px] font-normal leading-none" placeholder="…" value={columnFilters.status??''} onChange={e=>setColumnFilters(v=>({...v,status:e.target.value}))}/></th><th className="w-[14%]">Company<input className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 text-[6px] font-normal leading-none" placeholder="…" value={columnFilters.company??''} onChange={e=>setColumnFilters(v=>({...v,company:e.target.value}))}/></th><th className="w-[12%]">Route<input className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 text-[6px] font-normal leading-none" placeholder="…" value={columnFilters.route??''} onChange={e=>setColumnFilters(v=>({...v,route:e.target.value}))}/></th><th className="w-[6%]">Vehicle<input className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 text-[6px] font-normal leading-none" placeholder="…" value={columnFilters.vehicle??''} onChange={e=>setColumnFilters(v=>({...v,vehicle:e.target.value}))}/></th><th className="w-[6%]">Driver<input className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 text-[6px] font-normal leading-none" placeholder="…" value={columnFilters.driver??''} onChange={e=>setColumnFilters(v=>({...v,driver:e.target.value}))}/></th><th className="w-[5%]">Job<input className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 text-[6px] font-normal leading-none" placeholder="…" value={columnFilters.job??''} onChange={e=>setColumnFilters(v=>({...v,job:e.target.value}))}/></th><th className="w-[7%]">Supplier<input className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 text-[6px] font-normal leading-none" placeholder="…" value={columnFilters.owner??''} onChange={e=>setColumnFilters(v=>({...v,owner:e.target.value}))}/></th><th className="w-[6%]">Rent<input className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 text-[6px] font-normal leading-none" placeholder="…" value={columnFilters.rent??''} onChange={e=>setColumnFilters(v=>({...v,rent:e.target.value}))}/></th><th className="w-[10%]">Rent Status<input className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 text-[6px] font-normal leading-none" placeholder="…" value={columnFilters.rentStatus??''} onChange={e=>setColumnFilters(v=>({...v,rentStatus:e.target.value}))}/></th></tr></thead><tbody>{visible.map(r=>{const ex=existing.get(r.id);const posted=postedTripIds.has(r.id);const legacyBlocked=legacyBlockedOnly.has(r.id);const locked=posted||legacyBlocked;return <tr key={r.id} className="border-t"><td className="p-1"><input type="checkbox" disabled={locked||busy} checked={selected.includes(r.id)} onChange={e=>toggle(r.id,e.target.checked)}/></td><td className="font-semibold text-[6px]">{r.trip_no}</td><td>{formatTripDate(r.trip_date)}</td><td><span className="rounded bg-slate-100 px-1 py-0.5 font-medium">{r.trip_status||r.financial_status||'—'}</span></td><td className="whitespace-normal break-words pr-0.5 text-[6px] leading-none">{r.customer_name||'—'}</td><td className="whitespace-normal break-words pr-1">{r.from_location||'—'} → {r.to_location||'—'}</td><td>{r.vehicle_no||'—'}</td><td className="truncate pr-0.5 text-[6px]" title={r.driver_name||''}>{r.driver_name||'—'}</td><td className="truncate pr-1" title={r.po_do_job_no||''}>{r.po_do_job_no||'—'}</td><td className="truncate pr-1" title={r.owner_name||supplierName}>{r.owner_name||supplierName||'—'}</td><td><input className="input h-5 w-full px-1 text-[7px]" type="number" min="0.01" step="0.01" disabled={locked||busy} value={posted?String(r.billed_supplier_net??''):amounts[r.id]??String(ex?.finalized_amount_snapshot??ex?.amount??r.supplier_rent??r.owner_rent??'')} onChange={e=>setAmounts(v=>({...v,[r.id]:e.target.value}))}/></td><td>{legacyBlocked?<span className="font-medium text-[6px] leading-none text-red-700">Legacy Rent — Correction Required</span>:posted?<span className="text-[6px] leading-none text-emerald-700">Posted {financialNumber(r.billed_supplier_net)}</span>:ex?.state==='finalized'?<span className="font-medium text-[6px] leading-none text-blue-700">Finalized — Ready to Post</span>:ex?<span className="font-medium text-[6px] leading-none text-amber-700">Pending — Ready to Finalize</span>:<span className="text-[6px] leading-none text-amber-700">Pending — Ready to Finalize</span>}</td></tr>})}</tbody></table></div>
  <div className="mt-2 flex items-center justify-between gap-2 text-[9px]"><strong>{selected.length} trip(s) selected</strong><div className="flex gap-2"><button className="btn" disabled={busy||!supplier||!selected.length||!reason.trim()} onClick={()=>void finalizeSelected()}>{busy?'Working…':'Finalize Selected'}</button><button className="btn-primary" disabled={busy||!account||!selected.length} onClick={()=>void postSelected()}>{busy?'Posting…':'Post Finalized Selected'}</button></div></div>
 </section></div>;
}
