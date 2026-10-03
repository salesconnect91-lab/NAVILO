import {useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useAuth} from '@/auth/AuthContext';
import NaviloDateInput from '@/components/NaviloDateInput';

import {fetchAllPages} from '@/lib/fetchAllPages';
import {validBulkMoney} from './transportBulkRates';
import {invoiceNumberError} from './transportInvoiceNumbers';
import TransportPagination from './TransportPagination';
import {financialNumber} from './transportFinancialTypes';

type Row={invoice_no?:string|null;id:string;party_id?:string;trip_id?:string;posted?:boolean;legacyBlocked?:boolean;trip_no:string;trip_date:string;trip_status?:string|null;financial_status?:string|null;customer_name?:string|null;vehicle_no?:string|null;driver_name?:string|null;from_location?:string|null;to_location?:string|null;po_do_job_no?:string|null;owner_name?:string|null;supplier_rent?:number|null;owner_rent?:number|null;billed_supplier_net?:number|null};
type LegacyRent={id:string;rent_state?:string|null;rent_finalized_at?:string|null};
type Supplier={id:string;name:string;is_active:boolean};
type Rent={id:string;trip_id:string;supplier_id:string;amount:number;state?:string;finalized_amount_snapshot?:number|null};
type Account={id:string;name:string;type:string};
const formatTripDate=(value:string)=>{if(!value)return '—';const [y,m,d]=value.slice(0,10).split('-').map(Number);if(!y||!m||!d)return value;return `${String(d).padStart(2,'0')}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1]}-${String(y).slice(-2)}`};

export default function TransportBulkSupplierRent({onClose,onChanged,initialTripId,initialSupplierName,compact=false}:{onClose:()=>void;onChanged:()=>Promise<void>;initialTripId?:string;initialSupplierName?:string;compact?:boolean}){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const [rows,setRows]=useState<Row[]>([]),[legacyRents,setLegacyRents]=useState<LegacyRent[]>([]),[suppliers,setSuppliers]=useState<Supplier[]>([]),[rents,setRents]=useState<Rent[]>([]),[accounts,setAccounts]=useState<Account[]>([]);
 const [supplier,setSupplier]=useState(''),[tripStatus,setTripStatus]=useState(''),[search,setSearch]=useState(''),[columnFilters,setColumnFilters]=useState<Record<string,string>>({}),[selected,setSelected]=useState<string[]>([]),[amounts,setAmounts]=useState<Record<string,string>>({});
 const [account,setAccount]=useState(''),[date,setDate]=useState(new Date().toISOString().slice(0,10)),[reason,setReason]=useState(compact?'':'Bulk supplier rent'),[withTax,setWithTax]=useState(false);
 const [permissions,setPermissions]=useState<Record<string,boolean>>({}),[loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [correctionTrip,setCorrectionTrip]=useState<Row|null>(null),[correctionRent,setCorrectionRent]=useState<Rent|null>(null),[correctionAmount,setCorrectionAmount]=useState('');
 const [descriptions,setDescriptions]=useState<Record<string,string>>({});
 const [invoiceNumbers,setInvoiceNumbers]=useState<Record<string,string>>({});
 const [page,setPage]=useState(0),[pageMeta,setPageMeta]=useState<{count:number;amount:number;statuses:string[]}>({count:0,amount:0,statuses:[]});
 const [singleRowKey,setSingleRowKey]=useState('');const compactDialog=useRef<HTMLElement>(null);
 const generation=useRef(0),submitting=useRef(false),initialApplied=useRef(false);
 const scopeKey=`${activeCompany?.company_id}/${activeBusinessUnit?.business_unit_id}`;
 const masterCache=useRef<{scope:string;expires:number;data:any[]}|null>(null);
 async function load(){
  const request=++generation.current;setLoading(true);
  try{
  const company=activeCompany?.company_id,unit=activeBusinessUnit?.business_unit_id;
  if(!company||!unit)throw new Error('Select an active company and business unit.');
  const resultPromise=supabase.rpc('transport_bulk_rate_page',{p_side:'supplier',p_limit:500,p_offset:page*500,p_filters:{party:compact?'':supplier,status:tripStatus,search,columns:columnFilters,initialTrip:initialTripId&&(compact||!initialApplied.current)?initialTripId:''}});
  const metadata=masterCache.current?.scope===scopeKey&&masterCache.current.expires>Date.now()?Promise.resolve(masterCache.current.data):Promise.all([
   fetchAllPages<Supplier>((from,to)=>supabase.from('suppliers').select('id,name,is_active').eq('company_id',company).order('id').range(from,to)),
   fetchAllPages<Account>((from,to)=>supabase.from('chart_of_accounts').select('id,name,type').eq('company_id',company).eq('is_active',true).eq('is_group',false).eq('type','expense').order('id').range(from,to)),
   Promise.all([...['rent','adjustment'].map(async action=>{const r=await supabase.rpc('transport_finance_allowed',{p_action:action});if(r.error)throw r.error;return [action,r.data===true] as const}),...['rent_finalize','rent_correct'].map(async action=>{const r=await supabase.rpc('has_transport_action_permission',{p_company_id:company,p_action:action});if(r.error)throw r.error;return [action,r.data===true] as const})]),
  ]).then(data=>{masterCache.current={scope:scopeKey,expires:Date.now()+30000,data};return data;});
  const [result,refs]=await Promise.all([resultPromise,metadata]);
  const [ss,aa,grants]=refs;
  if(request!==generation.current)return;if(result.error)throw result.error;
  const data=result.data;setRows(data.rows);setSelected(current=>current.filter(id=>data.rows.some((r:any)=>r.id===id)));setPageMeta(data);
  if(page>Math.max(0,Math.ceil(data.count/500)-1))setPage(Math.max(0,Math.ceil(data.count/500)-1));
  setLegacyRents(data.rows.filter((r:any)=>r.legacyBlocked).map((r:any)=>({id:r.id,rent_state:'finalized'})));
  setSuppliers(ss.sort((a,b)=>a.name.localeCompare(b.name)));
  setRents(data.rows.filter((r:any)=>r.rent).map((r:any)=>r.rent));
  setAccounts(aa);setPermissions(Object.fromEntries(grants));
  }finally{if(request===generation.current)setLoading(false);}
 }
 useEffect(()=>{masterCache.current=null;initialApplied.current=false;setRows([]);setPermissions({});setPage(0);setSelected([]);setAmounts({});setInvoiceNumbers({});setDescriptions({});setCorrectionTrip(null);setSupplier('');setAccount('');},[scopeKey]);
 useEffect(()=>{
  if(loading||initialApplied.current)return;initialApplied.current=true;
  if(initialSupplierName&&!compact){const match=suppliers.find(s=>s.name===initialSupplierName);if(match)setSupplier(match.id);}
  if(initialTripId){const r=rows.find(x=>x.trip_id===initialTripId&&(!initialSupplierName||x.owner_name===initialSupplierName));if(r&&!r.posted&&!r.legacyBlocked)setSelected([r.id]);}
 },[loading,initialTripId,initialSupplierName,rows,suppliers]);
 const filterKey=JSON.stringify({scopeKey,supplier:compact?'':supplier,tripStatus,search,columnFilters});
 const lastFilterKey=useRef(filterKey);
 useEffect(()=>{
  generation.current++;setLoading(true);setRows([]);
  let active=true;
  const changed=lastFilterKey.current!==filterKey;lastFilterKey.current=filterKey;
  if(changed&&page!==0){setPage(0);return;}
  const timer=window.setTimeout(()=>void load().catch(e=>{if(active)setError(e.message)}),200);
  return()=>{active=false;window.clearTimeout(timer);generation.current++;};
 },[filterKey,page]);
 const existing=useMemo(()=>new Map(rents.map(r=>[r.trip_id,r])),[rents]);
 const canFinalize=(id:string)=>!unavailableTripIds.has(id)&&Boolean(permissions[existing.get(id)?.state==='finalized'?'rent_correct':'rent_finalize'])&&Boolean(existing.has(id)||permissions.rent);
 const legacyBlockedTripIds=useMemo(()=>new Set(legacyRents.filter(r=>r.rent_state==='finalized'||!!r.rent_finalized_at).map(r=>r.id)),[legacyRents]);
 const postedTripIds=useMemo(()=>new Set(rows.filter(r=>r.posted===true).map(r=>r.id)),[rows]);
 const legacyBlockedOnly=useMemo(()=>new Set([...legacyBlockedTripIds].filter(id=>!existing.has(id)&&!postedTripIds.has(id))),[legacyBlockedTripIds,existing,postedTripIds]);
 const unavailableTripIds=useMemo(()=>new Set([...postedTripIds,...legacyBlockedOnly]),[postedTripIds,legacyBlockedOnly]);
 const supplierName=suppliers.find(s=>s.id===supplier)?.name??'';
 const tripStatuses=pageMeta.statuses;
 const visible=rows;
 function toggle(id:string,on:boolean){setSelected(v=>on?[...new Set([...v,id])]:v.filter(x=>x!==id));}
 function selectShown(){const ids=visible.filter(r=>canFinalize(r.id)||(!unavailableTripIds.has(r.id)&&existing.get(r.id)?.state==='finalized'&&permissions.rent)).map(r=>r.id);setSelected(ids);}
 async function runBatch(kind:'finalize'|'post',ids=selected){
  if(submitting.current||busy||loading||!ids.length)return;
  const candidates=rows.filter(r=>ids.includes(r.id)&&!unavailableTripIds.has(r.id)&&(kind==='finalize'?canFinalize(r.id):existing.get(r.id)?.state==='finalized'&&permissions.rent));
  if(!candidates.length)return;
  if(kind==='post'){const problem=invoiceNumberError(candidates.map(r=>invoiceNumbers[r.id]??''));if(problem){setError(problem);return;}}
  if(kind==='finalize'&&(!reason.trim()||candidates.some(r=>!validBulkMoney(amounts[r.id]??String(existing.get(r.id)?.amount??r.supplier_rent??''))))){setError('Enter a nonnegative amount with at most two decimals and a reason.');return;}
  if(kind==='finalize'&&candidates.some(r=>!existing.has(r.id))&&!suppliers.some(s=>s.id===supplier&&s.is_active)){setError('Select an active supplier for new rent.');return;}
  if(kind==='post'&&(!account||!date))return;
  submitting.current=true;setBusy(true);setError('');setMessage('');const completed=new Set<string>();let failure='';
  try{for(const row of candidates){
   let rent=existing.get(row.id);let result;
   if(kind==='finalize'){
    const amount=Number(amounts[row.id]??rent?.amount??row.supplier_rent);
    if(!rent){const add=await supabase.rpc('transport_add_supplier_rent',{p_trip_id:row.trip_id,p_supplier_id:supplier,p_amount:amount,p_reason:reason.trim()});if(add.error)throw add.error;rent={id:add.data,trip_id:row.id,supplier_id:supplier,amount};}
    result=await supabase.rpc('transport_finalize_supplier_rent',{p_rent_id:rent.id,p_amount:amount,p_reason:reason.trim()});
   }else result=await supabase.rpc(descriptions[row.id]?.trim()?'transport_post_supplier_bill_described':invoiceNumbers[row.id]?.trim()?'transport_post_supplier_bill_numbered':'transport_post_supplier_bill',{p_rent_id:rent!.id,p_date:date,p_cost_account_id:account,p_with_tax:withTax,p_reference:'Bulk supplier rent',...(invoiceNumbers[row.id]?.trim()?{p_invoice_no:invoiceNumbers[row.id].trim()}:{}),...(descriptions[row.id]?.trim()?{p_description:descriptions[row.id].trim()}:{})});
   if(result.error)throw result.error;completed.add(row.id);
  }}catch(e:any){failure=e?.message||String(e);}
  try{await load();await onChanged()}catch(e:any){failure+=` Refresh failed: ${e?.message||e}. Refresh before another action.`;setPermissions({});}
  setDescriptions(v=>Object.fromEntries(Object.entries(v).filter(([id])=>!completed.has(id))));
  setInvoiceNumbers(v=>Object.fromEntries(Object.entries(v).filter(([id])=>!completed.has(id))));
  setSelected(v=>v.filter(id=>!completed.has(id)));setAmounts(v=>Object.fromEntries(Object.entries(v).filter(([id])=>!completed.has(id))));
  setMessage(`${completed.size} row(s) ${kind==='finalize'?'saved/finalized':'posted'}. ${ids.length-candidates.length} ineligible row(s) skipped.`);
  if(failure)setError(`${failure} · ${completed.size} completed before this error.`);
  submitting.current=false;setBusy(false);
  if(compact&&!failure&&completed.size===1)onClose();
 }
 async function correctPostedRent(){
  if(submitting.current||busy||loading||!permissions.adjustment||!correctionTrip||!correctionRent||!date||!reason.trim()||!validBulkMoney(correctionAmount)||Number(correctionAmount)===correctionRent.amount)return;
  submitting.current=true;setBusy(true);setError('');setMessage('');let saved=false;
  try{const adj=await supabase.rpc('transport_adjust_rate',{p_trip_id:correctionTrip.trip_id,p_side:'supplier',p_new_rate:Number(correctionAmount),p_reason:reason.trim(),p_date:date,p_rent_id:correctionRent.id,p_reference:'Bulk supplier rent correction'});if(adj.error)throw adj.error;saved=true;setCorrectionTrip(null);setCorrectionRent(null);setCorrectionAmount('');await load();await onChanged();setMessage('Posted rent corrected; canonical AP adjustment created.');}
  catch(e:any){setError(`${saved?'Correction posted; refresh failed. ':''}${e?.message||e}`);if(saved)setPermissions({});}finally{submitting.current=false;setBusy(false)}
 }
 const singleRows=rows.filter(r=>r.trip_id===initialTripId);
 const singleRow=singleRows.find(r=>r.id===singleRowKey)||singleRows.find(r=>r.owner_name===initialSupplierName)||singleRows[0];
 const singleRent=singleRow?existing.get(singleRow.id):undefined;
 const singlePosted=Boolean(singleRow?.posted);
 const singleAmount=singleRow?(amounts[singleRow.id]??String(singleRow.billed_supplier_net??singleRent?.finalized_amount_snapshot??singleRent?.amount??singleRow.supplier_rent??singleRow.owner_rent??'')):'';
 const singleBlocked=Boolean(singleRow&&legacyBlockedOnly.has(singleRow.id));
 useEffect(()=>{if(compact&&singleRow){const owner=singleRow.party_id||singleRent?.supplier_id||suppliers.find(s=>s.name===singleRow.owner_name)?.id;if(owner)setSupplier(owner);}},[compact,singleRow?.id,singleRent?.supplier_id,suppliers]);
 async function saveSingle(){
  if(!singleRow||busy||loading||singleBlocked||!reason.trim()||!validBulkMoney(singleAmount))return;
  if(!singlePosted){await runBatch('finalize',[singleRow.id]);return;}
  if(!permissions.adjustment||!singleRent||!date||Number(singleAmount)===Number(singleRow.billed_supplier_net??singleRent.amount)||submitting.current)return;
  submitting.current=true;setBusy(true);setError('');let saved=false;
  try{const result=await supabase.rpc('transport_adjust_rate',{p_trip_id:singleRow.trip_id,p_side:'supplier',p_new_rate:Number(singleAmount),p_reason:reason.trim(),p_date:date,p_rent_id:singleRent.id,p_reference:'Trips grid supplier rent correction'});if(result.error)throw result.error;saved=true;await onChanged();onClose();}
  catch(e:any){setError(`${saved?'Correction posted; refresh failed. ':''}${e?.message||e}`);if(saved)setPermissions({});}finally{submitting.current=false;setBusy(false);}
 }
 if(compact)return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-3" onKeyDown={e=>{if(e.key==='Escape'&&!busy)onClose();if(e.key==='Tab'){const items=compactDialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)');if(items?.length){const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}}}}>
  <section ref={compactDialog} role="dialog" aria-modal="true" aria-labelledby="supplier-rate-title" className="w-full max-w-sm rounded bg-white p-4 text-sm shadow-xl">
   <h2 id="supplier-rate-title" className="font-semibold">{singlePosted?'Correct':'Update'} Supplier Rate · {singleRow?.trip_no||''}</h2>
   {loading?<p role="status">Loading supplier rate…</p>:singleRow?<>
    <p className="my-2 text-xs text-slate-600">{singleRow.customer_name}<br/>{singleRow.from_location} → {singleRow.to_location}<br/>{singleRow.vehicle_no} · {singleRow.owner_name}</p>
    {singleRows.length>1&&<label className="block text-xs font-semibold">Supplier rent<select className="input mt-1 w-full" disabled={busy} value={singleRow.id} onChange={e=>{setSingleRowKey(e.target.value);setReason('');setError('')}}>{singleRows.map(r=><option key={r.id} value={r.id}>{r.owner_name} · {financialNumber(r.billed_supplier_net??r.supplier_rent)}</option>)}</select></label>}
    <label className="block text-xs font-semibold">Supplier rate excluding VAT<input autoFocus className="input mt-1 w-full" type="number" min="0" step="0.01" disabled={busy||singleBlocked} value={singleAmount} onChange={e=>setAmounts(v=>({...v,[singleRow.id]:e.target.value}))}/></label>
    {singlePosted&&<label className="mt-2 block text-xs font-semibold">Correction Date<NaviloDateInput className="input mt-1 w-full" type="date" disabled={busy} value={date} onChange={e=>setDate(e.target.value)}/></label>}
    <label className="mt-2 block text-xs font-semibold">Reason<input className="input mt-1 w-full" disabled={busy} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Required for supplier rate change"/></label>
    <p className="my-2 text-xs text-slate-600">{singleBlocked?'Legacy rent requires controlled correction before structured supplier rents.':singlePosted?'Posted rent is never overwritten. Saving creates the controlled canonical AP adjustment.':'Saving finalizes the supplier rate. Post the supplier invoice separately from Bulk Supplier Rent.'}</p>
   </>:<p>No supplier rent is available for this Trip.</p>}
   {error&&<p role="alert" className="my-2 text-red-700">{error}</p>}
   <div className="mt-3 flex justify-end gap-2"><button className="btn" disabled={busy} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={loading||busy||!singleRow||singleBlocked||!reason.trim()||!validBulkMoney(singleAmount)||(singlePosted?(!permissions.adjustment||!singleRent||!date||Number(singleAmount)===Number(singleRow?.billed_supplier_net??singleRent?.amount)):!canFinalize(singleRow.id))} onClick={()=>void saveSingle()}>{busy?'Saving…':singlePosted?'Post Correction':'Save Rate'}</button></div>
  </section>
 </div>;
 return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-3"><section className="flex max-h-[88vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-lg bg-white p-2 text-[10px] leading-tight shadow-xl">
  <div className="flex shrink-0 items-center justify-between"><div><h2 className="text-sm font-bold leading-tight">Bulk Supplier Rent</h2><p className="text-[9px] leading-tight text-slate-500">Select supplier → finalize rents → post invoice. Record actual full or partial supplier payments separately. Posted rents use controlled correction. Each trip creates its own bill. Invoice # is editable before posting; blank uses automatic numbering.</p></div><button className="btn" disabled={busy||loading} onClick={onClose}>Close</button></div>
  {loading&&<p role="status">Loading page…</p>}
  {error&&<p role="alert" className="my-2 text-red-700">{error}</p>}{message&&<p role="status" className="my-2 text-emerald-700">{message}</p>}
  <fieldset disabled={busy||loading} className="my-2 grid shrink-0 grid-cols-12 items-end gap-1 rounded border bg-slate-50 p-1 text-[9px] leading-tight">
   <label className="col-span-2">Supplier<select className="input h-7 px-1 text-[10px]" value={supplier} onChange={e=>{setSupplier(e.target.value);setSelected([]);setAmounts({})}}><option value="">All Suppliers</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}{s.is_active?'':' (inactive)'}</option>)}</select></label>
   <label className="col-span-3">Expense account<select className="input h-7 px-1 text-[10px]" value={account} onChange={e=>setAccount(e.target.value)}><option value="">Select account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
   <label className="col-span-2">Date<NaviloDateInput className="input h-7 px-1 text-[10px]" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
   <label className="col-span-3">Reason<input className="input h-7 px-1 text-[10px]" value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <label className="col-span-2 pb-1"><input type="checkbox" checked={withTax} onChange={e=>setWithTax(e.target.checked)}/> With VAT</label>
   <label className="col-span-2">Trip Status<select className="input h-7 px-1 text-[10px]" value={tripStatus} onChange={e=>{setTripStatus(e.target.value);setSelected([])}}><option value="">All Statuses</option>{tripStatuses.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
   <label className="col-span-5">Search Trip / Company / Route / Vehicle<input className="input h-7 px-1 text-[10px]" value={search} onChange={e=>setSearch(e.target.value)}/></label>
   <button className="btn col-span-2 h-7 text-[9px]" disabled={loading||busy||!visible.some(r=>canFinalize(r.id)||(!unavailableTripIds.has(r.id)&&permissions.rent))} onClick={selectShown}>Select Page Unposted</button>
  </fieldset>
  <div className="min-h-0 flex-1 overflow-auto border"><table className="w-full min-w-[1080px] table-fixed text-left [&_th]:!text-[11px] [&_tbody_tr]:!h-[38px] [&_tbody_td]:!h-[38px] [&_tbody_td]:!px-1 [&_tbody_td]:!py-0.5 [&_tbody_td]:!text-[12px] [&_tbody_td]:!leading-[15px] [&_tbody_span:not([data-rate-status])]:!text-[12px] [&_tbody_span:not([data-rate-status])]:!leading-[15px] [&_tbody_input]:!text-[12px]"><thead className="sticky top-0 bg-slate-100"><tr><th className="w-[3%] p-1">Sel.</th><th className="w-[7%]">Trip<input aria-label="Filter trip" disabled={busy||loading} className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 !text-[10px] font-normal leading-none" placeholder="…" value={columnFilters.trip??''} onChange={e=>setColumnFilters(v=>({...v,trip:e.target.value}))}/></th><th className="w-[6%]">Date<input aria-label="Filter date" disabled={busy||loading} className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 !text-[10px] font-normal leading-none" placeholder="…" value={columnFilters.date??''} onChange={e=>setColumnFilters(v=>({...v,date:e.target.value}))}/></th><th className="w-[6%]">Status<input aria-label="Filter status" disabled={busy||loading} className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 !text-[10px] font-normal leading-none" placeholder="…" value={columnFilters.status??''} onChange={e=>setColumnFilters(v=>({...v,status:e.target.value}))}/></th><th className="w-[14%]">Company<input aria-label="Filter company" disabled={busy||loading} className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 !text-[10px] font-normal leading-none" placeholder="…" value={columnFilters.company??''} onChange={e=>setColumnFilters(v=>({...v,company:e.target.value}))}/></th><th className="w-[12%]">Route<input aria-label="Filter route" disabled={busy||loading} className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 !text-[10px] font-normal leading-none" placeholder="…" value={columnFilters.route??''} onChange={e=>setColumnFilters(v=>({...v,route:e.target.value}))}/></th><th className="w-[6%]">Vehicle<input aria-label="Filter vehicle" disabled={busy||loading} className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 !text-[10px] font-normal leading-none" placeholder="…" value={columnFilters.vehicle??''} onChange={e=>setColumnFilters(v=>({...v,vehicle:e.target.value}))}/></th><th className="w-[6%]">Driver<input aria-label="Filter driver" disabled={busy||loading} className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 !text-[10px] font-normal leading-none" placeholder="…" value={columnFilters.driver??''} onChange={e=>setColumnFilters(v=>({...v,driver:e.target.value}))}/></th><th className="w-[5%]">Job<input aria-label="Filter job" disabled={busy||loading} className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 !text-[10px] font-normal leading-none" placeholder="…" value={columnFilters.job??''} onChange={e=>setColumnFilters(v=>({...v,job:e.target.value}))}/></th><th className="w-[7%]">Supplier<input aria-label="Filter owner" disabled={busy||loading} className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 !text-[10px] font-normal leading-none" placeholder="…" value={columnFilters.owner??''} onChange={e=>setColumnFilters(v=>({...v,owner:e.target.value}))}/></th><th className="w-[6%]">Rent<input aria-label="Filter rent" disabled={busy||loading} className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 !text-[10px] font-normal leading-none" placeholder="…" value={columnFilters.rent??''} onChange={e=>setColumnFilters(v=>({...v,rent:e.target.value}))}/></th><th className="w-[10%]">Rent Status<input aria-label="Filter rentStatus" disabled={busy||loading} className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 !text-[10px] font-normal leading-none" placeholder="…" value={columnFilters.rentStatus??''} onChange={e=>setColumnFilters(v=>({...v,rentStatus:e.target.value}))}/></th></tr></thead><tbody>{visible.map(r=>{const ex=existing.get(r.id);const posted=postedTripIds.has(r.id);const legacyBlocked=legacyBlockedOnly.has(r.id);const locked=posted||legacyBlocked;return <tr key={r.id} className="h-[38px] border-t"><td className="px-1 py-0"><input aria-label={`Select ${r.trip_no} ${r.owner_name}`} className="h-3.5 w-3.5" type="checkbox" disabled={loading||!permissions.rent||locked||busy} checked={selected.includes(r.id)} onChange={e=>toggle(r.id,e.target.checked)}/></td><td className="font-semibold"><span className="block whitespace-nowrap">{r.trip_no}</span><input aria-label={`Invoice number ${r.trip_no} ${r.owner_name}`} title={r.invoice_no||invoiceNumbers[r.id]||'Optional invoice number; blank uses automatic numbering'} className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 !text-[10px] font-normal" maxLength={80} placeholder="Invoice # (auto)" disabled={locked||busy||loading||!permissions.rent} value={r.invoice_no??invoiceNumbers[r.id]??''} onChange={e=>setInvoiceNumbers(v=>({...v,[r.id]:e.target.value}))}/><input aria-label={`Description ${r.trip_no} ${r.owner_name}`} title="Optional invoice description; Trip details are added automatically" className="input mt-0.5 h-[24px] w-full px-1 py-0 !text-[10px]" maxLength={2000} placeholder="Description (optional)" disabled={locked||!permissions.rent||busy||loading} value={descriptions[r.id]??''} onChange={e=>setDescriptions(v=>({...v,[r.id]:e.target.value}))}/></td><td className="whitespace-nowrap">{formatTripDate(r.trip_date)}</td><td><span className="rounded bg-slate-100 px-1 py-0.5 font-medium">{r.trip_status||'—'||'—'}</span></td><td className="pr-1"><span className="block max-h-[30px] overflow-hidden leading-[15px]">{r.customer_name||'—'}</span></td><td className="pr-1"><span className="block max-h-[30px] overflow-hidden leading-[15px]">{r.from_location||'—'} → {r.to_location||'—'}</span></td><td>{r.vehicle_no||'—'}</td><td className="truncate pr-0.5" title={r.driver_name||''}>{r.driver_name||'—'}</td><td className="truncate pr-1" title={r.po_do_job_no||''}>{r.po_do_job_no||'—'}</td><td className="truncate pr-1" title={r.owner_name||supplierName}>{r.owner_name||supplierName||'—'}</td><td><input aria-label={`Rent ${r.trip_no} ${r.owner_name}`} className="input h-[30px] w-full px-1 py-0 !text-[12px] !leading-[15px]" type="number" min="0.01" step="0.01" disabled={loading||!permissions.rent||locked||busy} value={posted?String(r.billed_supplier_net??''):amounts[r.id]??String(ex?.finalized_amount_snapshot??ex?.amount??r.supplier_rent??r.owner_rent??'')} onChange={e=>setAmounts(v=>({...v,[r.id]:e.target.value}))}/></td><td>{legacyBlocked?<span data-rate-status className="font-medium text-[10px] leading-tight text-red-700">Legacy Rent — Correction Required</span>:posted?<div className="flex flex-col items-start gap-0 leading-[13px]"><span data-rate-status className="text-[10px] leading-tight text-emerald-700">Posted {financialNumber(r.billed_supplier_net)}</span>{ex&&<button type="button" className="text-[10px] font-semibold text-blue-700 underline" disabled={busy||loading||!permissions.adjustment} onClick={()=>{setCorrectionTrip(r);setCorrectionRent(ex);setCorrectionAmount(String(r.billed_supplier_net??ex.amount));setReason('')}}>Correct Rent</button>}</div>:ex?.state==='finalized'?<span data-rate-status className="font-medium text-[10px] leading-tight text-blue-700">Finalized — Editable Until Post</span>:ex?<span data-rate-status className="font-medium text-[10px] leading-tight text-amber-700">Pending — Ready to Finalize</span>:<span data-rate-status className="text-[10px] leading-tight text-amber-700">Pending — Ready to Finalize</span>}</td></tr>})}</tbody></table></div>
  <TransportPagination page={page} pageSize={500} count={pageMeta.count} busy={loading||busy} onPage={setPage}/>
  <p className="shrink-0 text-[10px] text-slate-500">All filtered rows: {pageMeta.count.toLocaleString()} · Total amount: {financialNumber(pageMeta.amount)}. Selection applies to this page.</p>
  {correctionTrip&&correctionRent&&<div className="shrink-0 border-t bg-amber-50 p-2 text-[10px]"><div className="flex flex-wrap items-end gap-2"><strong>{correctionTrip.trip_no} · Posted Rent Correction</strong><span>Current: {financialNumber(correctionTrip.billed_supplier_net)}</span><label>New Rent <input className="input h-7 w-28 px-1 text-[11px]" type="number" min="0" step="0.01" disabled={busy} value={correctionAmount} onChange={e=>setCorrectionAmount(e.target.value)}/></label><label className="min-w-[220px] flex-1">Correction Reason <input className="input h-7 w-full px-1 text-[11px]" value={reason} onChange={e=>setReason(e.target.value)} placeholder="Reason required"/></label><button className="btn-primary h-7" disabled={loading||!permissions.adjustment||busy||!reason.trim()||!validBulkMoney(correctionAmount)||Number(correctionAmount)===correctionRent.amount} onClick={()=>void correctPostedRent()}>Save Correction</button><button className="btn h-7" disabled={busy||loading||!permissions.adjustment} onClick={()=>{setCorrectionTrip(null);setCorrectionRent(null);setCorrectionAmount('')}}>Cancel</button></div><p className="mt-1 text-slate-600">Original posted bill/payment history stays unchanged; NAVILO posts only the difference as a canonical AP adjustment.</p></div>}
  <div className="mt-2 flex shrink-0 items-center justify-between gap-2 text-[9px]"><strong>{selected.length} trip(s) selected</strong><div className="flex gap-2"><button className="btn" disabled={loading||busy||!selected.some(canFinalize)||!reason.trim()||selected.some(id=>!existing.has(id)&&!supplier)} onClick={()=>void runBatch('finalize')}>{busy?'Working…':'Finalize Selected'}</button><button className="btn-primary" disabled={loading||!permissions.rent||busy||!account||!date||!selected.some(id=>!unavailableTripIds.has(id)&&existing.get(id)?.state==='finalized')} onClick={()=>void runBatch('post')}>{busy?'Posting…':'Post Finalized Selected'}</button></div></div>
 </section></div>;
}
