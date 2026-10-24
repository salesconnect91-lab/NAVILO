Warning: truncated output (original token count: 11124)
Total output lines: 245

import TransportCommercialHeader,{TransportCommercialSummary} from './TransportCommercialHeader';
import TransportReasonSelect from './TransportReasonSelect';
import TransportDialog from './TransportDialog';
import NaviloSearchableSelect from "@/components/SearchableSelect";
import {vehicleDisplayLabel} from "@/lib/transportVehicleLabel";
import useTransportBillingMode from './useTransportBillingMode';
import TransportVatPreview from './TransportVatPreview';
import './transportBulkRateLayout.css';
import {useEffect,useMemo,useRef,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useAuth} from '@/auth/AuthContext';
import NaviloDateInput from '@/components/NaviloDateInput';

import {fetchAllPages} from '@/lib/fetchAllPages';
import {validBulkMoney} from './transportBulkRates';
import {invoiceNumberError} from './transportInvoiceNumbers';
import TransportPagination from './TransportPagination';
import {financialNumber} from './transportFinancialTypes';
import TransportSupplierCharges from './TransportSupplierCharges';
import {SUPPLIER_RATE_REASON_OPTIONS} from './transportRateReasons';

type Row={invoice_no?:string|null;id:string;party_id?:string;trip_id?:string;posted?:boolean;draftLinked?:boolean;legacyBlocked?:boolean;trip_no:string;trip_date:string;trip_status?:string|null;financial_status?:string|null;customer_name?:string|null;vehicle_no?:string|null;truck_type_name?:string|null;truck_type?:string|null;driver_name?:string|null;from_location?:string|null;to_location?:string|null;po_do_job_no?:string|null;owner_name?:string|null;supplier_rent?:number|null;owner_rent?:number|null;billed_supplier_net?:number|null;supplier_charges?:number|null;supplier_charge_names?:string|null};
type LegacyRent={id:string;rent_state?:string|null;rent_finalized_at?:string|null};
type Supplier={id:string;name:string;is_active:boolean};
type Rent={id:string;trip_id:string;supplier_id:string;amount:number;base_amount?:number|null;state?:string;finalized_amount_snapshot?:number|null};
type Account={id:string;name:string;type:string};
const formatTripDate=(value:string)=>{if(!value)return '—';const [y,m,d]=value.slice(0,10).split('-').map(Number);if(!y||!m||!d)return value;return `${String(d).padStart(2,'0')}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1]}-${String(y).slice(-2)}`};

export default function TransportBulkSupplierRent({onClose,onChanged,initialTripId,initialSupplierName,compact=false}:{onClose:()=>void;onChanged:()=>Promise<void>;initialTripId?:string;initialSupplierName?:string;compact?:boolean}){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const [rows,setRows]=useState<Row[]>([]),[legacyRents,setLegacyRents]=useState<LegacyRent[]>([]),[suppliers,setSuppliers]=useState<Supplier[]>([]),[rents,setRents]=useState<Rent[]>([]),[accounts,setAccounts]=useState<Account[]>([]);
 const [supplier,setSupplier]=useState(''),[tripStatus,setTripStatus]=useState(''),[search,setSearch]=useState(''),[columnFilters,setColumnFilters]=useState<Record<string,string>>({}),[selected,setSelected]=useState<string[]>([]),[amounts,setAmounts]=useState<Record<string,string>>({});
 const [account,setAccount]=useState(''),[date,setDate]=useState(new Date().toISOString().slice(0,10)),[reason,setReason]=useState('Supplier rent finalized');const [vatReady,setVatReady]=useState(true),[vatRate,setVatRate]=useState<number|null>(0);
 const selectedParties=[...new Set(rows.filter(r=>selected.includes(r.id)&&!r.posted).map(r=>r.party_id).filter(Boolean))];
 const billing=useTransportBillingMode('supplier',supplier||(selectedParties.length===1?selectedParties[0]:''));const withTax=billing.withTax;
 const [compactReasonPreset,setCompactReasonPreset]=useState('');
 const [permissions,setPermissions]=useState<Record<string,boolean>>({}),[loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [correctionTrip,setCorrectionTrip]=useState<Row|null>(null),[correctionRent,setCorrectionRent]=useState<Rent|null>(null),[correctionAmount,setCorrectionAmount]=useState('');
 const [descriptions,setDescriptions]=useState<Record<string,string>>({});
 const [supplierReference,setSupplierReference]=useState('');
 const [invoiceNumber,setInvoiceNumber]=useState('');
 const [createdDraft,setCreatedDraft]=useState<{id:string;orderId:string;number:string;count:number}|null>(null);
 const [page,setPage]=useState(0),[pageMeta,setPageMeta]=useState<{count:number;amount:number;statuses:string[]}>({count:0,amount:0,statuses:[]});
 const [singleRowKey,setSingleRowKey]=useState(''),[chargeRent,setChargeRent]=useState<{rent:Rent;tripNo:string}|null>(null);const [singleCorrectionMode,setSingleCorrectionMode]=useState(false),[singleConfirmFinancialPost,setSingleConfirmFinancialPost]=useState(false);const compactDialog=useRef<HTMLElement>(null);
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
   fetchAllPages<{mapping_key:string;account_id:string}>((from,to)=>supabase.from('account_mappings').select('mapping_key,account_id').eq('company_id',company).eq('mapping_key','transport_expense').range(from,to)),
   Promise.all([...['rent','adjustment'].map(async action=>{const r=await supabase.rpc('transport_finance_allowed',{p_action:action});if(r.error)throw r.error;return [action,r.data===true] as const}),...['rent_finalize','rent_correct'].map(async action=>{const r=await supabase.rpc('has_transport_action_permission',{p_company_id:company,p_action:action});if(r.error)throw r.error;return [action,r.data===true] as const})]),
  ]).then(data=>{masterCache.current={scope:scopeKey,expires:Date.now()+30000,data};return data;});
  const [result,refs]=await Promise.all([resultPromise,metadata]);
  const [ss,aa,mappings,grants]=refs;
  if(request!==generation.current)return;if(result.error)throw result.error;
  const data=result.data;
  const rentIds=data.rows.map((r:any)=>r.rent?.id).filter(Boolean);
  const chargeResult=rentIds.length?await supabase.from('transport_trip_supplier_charges').select('rent_id,amount,name_snapshot').in('rent_id',rentIds):{data:[],error:null};
  if(chargeResult.error)throw chargeResult.error;
  const chargesByRent=new Map<string,{amount:number;names:string[]}>();
  for(const x of chargeResult.data??[]){const v=chargesByRent.get(x.rent_id)??{amount:0,names:[]};v.amount+=Number(x.amount||0);if(x.name_snapshot)v.names.push(x.name_snapshot);chargesByRent.set(x.rent_id,v);}
  const enrichedRows=data.rows.map((r:any)=>{const x=chargesByRent.get(r.rent?.id);return {...r,supplier_charges:x?.amount??0,supplier_charge_names:x?.names.join(', ')??''};});
  setRows(enrichedRows);setSelected(current=>current.filter(id=>enrichedRows.some((r:any)=>r.id===id)));setPageMeta(data);
  if(page>Math.max(0,Math.ceil(data.count/500)-1))setPage(Math.max(0,Math.ceil(data.count/500)-1));
  setLegacyRents(data.rows.filter((r:any)=>r.legacyBlocked).map((r:any)=>({id:r.id,rent_state:'finalized'})));
  setSuppliers(ss.sort((a,b)=>a.name.localeCompare(b.name)));
  setRents(data.rows.filter((r:any)=>r.rent).map((r:any)=>r.rent));
  setAccounts(aa);const transportExpense=mappings.find(m=>m.mapping_key==='transport_expense')?.account_id;if(transportExpense&&aa.some(a=>a.id===transportExpense))setAccount(current=>current||transportExpense);setPermissions(Object.fromEntries(grants));
  }finally{if(request===generation.current)setLoading(false);}
 }
 useEffect(()=>{masterCache.current=null;initialApplied.current=false;setRows([]);setPermissions({});setPage(0);setSelected([]);setAmounts({});setInvoiceNumber('');setSupplierReference('');setDescriptions({});setCorrectionTrip(null);setSingleCorrectionMode(false);setSingleConfirmFinancialPost(false);setSupplier('');setAccount('');},[scopeKey]);
 useEffect(()=>{
  if(loading||initialApplied.current)return;initialApplied.current=true;
  if(initialSupplierName&&!compact){const match=suppliers.find(s=>s.name===initialSupplierName);if(match)setSupplier(match.id);}
  if(initialTripId){const r=rows.find(x=>x.trip_id===initialTripId&&(!initialSupplierName||x.owner_name===initialSupplierName));if(r&&!r.posted&&!r.legacyBlocked)setSelected([r.id]);}
 },[loading,initialTripId,initialSupplierName,rows,suppliers]);
 const filterKey=JSON.stringify({scopeKey,supplier:compact?'':supplier,tripStatus,search,columnFilters});
 const lastFilterKey=useRef(filterKey);
 useEffect(()=>{
  generation.current++;setLoading(true);setError('');setRows([]);
  let active=true;
  const changed=lastFilterKey.current!==filterKey;lastFilterKey.current=filterKey;
  if(changed&&page!==0){setPage(0);return;}
  const timer=window.setTimeout(()=>void load().catch(e=>{if(active)setError(e.message)}),200);
  return()=>{active=false;window.clearTimeout(timer);generation.current++;};
 },[filterKey,page]);
 const existing=useMemo(()=>new Map(rents.map(r=>[r.id,r])),[rents]);
 const supplierBase=(rent?:Rent,amount?:number|null,charges=0)=>rent?.base_amount??Math.max(0,Number(rent?.amount??amount??0)-charges);
 const canFinalize=(id:string)=>!unavailableTripIds.has(id)&&Boolean(permissions[existing.get(id)?.state==='finalized'?'rent_correct':'rent_finalize'])&&Boolean(existing.has(id)||permissions.rent);
 const legacyBlockedTripIds=useMemo(()=>new Set(legacyRents.filter(r=>r.rent_state==='finalized'||!!r.rent_finalized_at).map(r=>r.id)),[legacyRents]);
 const postedTripIds=useMemo(()=>new Set(rows.filter(r=>r.posted===true).map(r=>r.id)),[rows]);
 const draftLinkedTripIds=useMemo(()=>new Set(rows.filter(r=>r.draftLinked===true).map(r=>r.id)),[rows]);
 const legacyBlockedOnly=useMemo(()=>new Set([...legacyBlockedTripIds].filter(id=>!existing.has(id)&&!postedTripIds.has(id))),[legacyBlockedTripIds,existing,postedTripIds]);
 const unavailableTripIds=useMemo(()=>new Set([...postedTripIds,...draftLinkedTripIds,...legacyBlockedOnly]),[postedTripIds,draftLinkedTripIds,legacyBlockedOnly]);
 const supplierName=suppliers.find(s=>s.id===supplier)?.name??'';
 const tripStatuses=pageMeta.statuses;
 const visible=rows;
 function toggle(id:string,on:boolean){setSelected(v=>on?[...new Set([...v,id])]:v.filter(x=>x!==id));}
 function selectShown(){const ids=visible.filter(r=>canFinalize(r.id)||(!unavailableTripIds.has(r.id)&&existing.get(r.id)?.state==='finalized'&&permissions.rent)).map(r=>r.id);setSelected(ids);}
 async function runBatch(kind:'finalize'|'draft',ids=selected){
  if(kind==='draft'&&!billing.ready){setError(billing.error||'Select a supplier with a configured Cash/Credit billing rule.');return;}
  if(kind==='draft'&&withTax&&(!vatReady||!supplierReference.trim())){setError('Valid VAT preview and original supplier invoice reference required for the selected invoice.');return;}
  if(submitting.curre…5124 tokens truncated…0px] table-fixed text-left [&_th]:!text-[11px] [&_tbody_td]:!h-auto [&_tbody_td]:!px-1 [&_tbody_td]:!py-0.5 [&_tbody_td]:!text-[12px] [&_tbody_td]:!leading-[15px] [&_tbody_span:not([data-rate-status])]:!text-[12px] [&_tbody_span:not([data-rate-status])]:!leading-[15px] [&_tbody_input]:!text-[12px]"><thead className="sticky top-0 bg-slate-100"><tr><th className="w-[3%] p-1">Sel.</th><th className="w-[25%]">Trip · Status · Cash/Credit · Route · Description<input aria-label="Filter trip" disabled={busy} className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 !text-[10px] font-normal leading-none" placeholder="…" value={columnFilters.trip??''} onChange={e=>setColumnFilters(v=>({...v,trip:e.target.value}))}/></th><th className="w-[6%]">Date<input aria-label="Filter date" disabled={busy} className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 !text-[10px] font-normal leading-none" placeholder="…" value={columnFilters.date??''} onChange={e=>setColumnFilters(v=>({...v,date:e.target.value}))}/></th><th className="w-[6%]">Status<input aria-label="Filter status" disabled={busy} className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 !text-[10px] font-normal leading-none" placeholder="…" value={columnFilters.status??''} onChange={e=>setColumnFilters(v=>({...v,status:e.target.value}))}/></th><th className="w-[14%]">Company<input aria-label="Filter company" disabled={busy} className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 !text-[10px] font-normal leading-none" placeholder="…" value={columnFilters.company??''} onChange={e=>setColumnFilters(v=>({...v,company:e.target.value}))}/></th><th className="w-[12%]">Route<input aria-label="Filter route" disabled={busy} className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 !text-[10px] font-normal leading-none" placeholder="…" value={columnFilters.route??''} onChange={e=>setColumnFilters(v=>({...v,route:e.target.value}))}/></th><th className="w-[6%]">Vehicle<input aria-label="Filter vehicle" disabled={busy} className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 !text-[10px] font-normal leading-none" placeholder="…" value={columnFilters.vehicle??''} onChange={e=>setColumnFilters(v=>({...v,vehicle:e.target.value}))}/></th><th className="w-[6%]">Driver<input aria-label="Filter driver" disabled={busy} className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 !text-[10px] font-normal leading-none" placeholder="…" value={columnFilters.driver??''} onChange={e=>setColumnFilters(v=>({...v,driver:e.target.value}))}/></th><th className="w-[5%]">Job<input aria-label="Filter job" disabled={busy} className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 !text-[10px] font-normal leading-none" placeholder="…" value={columnFilters.job??''} onChange={e=>setColumnFilters(v=>({...v,job:e.target.value}))}/></th><th className="w-[7%]">Supplier<input aria-label="Filter owner" disabled={busy} className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 !text-[10px] font-normal leading-none" placeholder="…" value={columnFilters.owner??''} onChange={e=>setColumnFilters(v=>({...v,owner:e.target.value}))}/></th><th className="w-[6%]">Rent<input aria-label="Filter rent" disabled={busy} className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 !text-[10px] font-normal leading-none" placeholder="…" value={columnFilters.rent??''} onChange={e=>setColumnFilters(v=>({...v,rent:e.target.value}))}/></th><th className="w-[5%]">Charges</th><th className="w-[6%]">VAT</th><th className="w-[10%]">Rent Status<input aria-label="Filter rentStatus" disabled={busy} className="mt-0.5 block h-4 w-full min-w-0 rounded border px-0.5 py-0 !text-[10px] font-normal leading-none" placeholder="…" value={columnFilters.rentStatus??''} onChange={e=>setColumnFilters(v=>({...v,rentStatus:e.target.value}))}/></th></tr></thead><tbody>{visible.map(r=>{const ex=existing.get(r.id);const posted=postedTripIds.has(r.id);const legacyBlocked=legacyBlockedOnly.has(r.id);const draftLinked=draftLinkedTripIds.has(r.id);const locked=posted||draftLinked||legacyBlocked;return <><tr key={r.id} className="border-t align-top"><td className="px-1 py-0"><input aria-label={`Select ${r.trip_no} ${r.owner_name}`} className="h-3.5 w-3.5" type="checkbox" disabled={loading||locked||busy||!(canFinalize(r.id)||(ex?.state==='finalized'&&permissions.rent))} checked={selected.includes(r.id)} onChange={e=>toggle(r.id,e.target.checked)}/></td><td className="font-semibold">
 <div className="flex flex-wrap items-baseline gap-x-2 leading-[14px]"><strong>{r.trip_no}</strong><span className="text-[10px] font-normal text-slate-600">{r.trip_status||'—'} · {(billing.modes[existing.get(r.id)?.supplier_id??r.party_id??'']||billing.mode||'—').toUpperCase()}</span></div>
 <div className="truncate text-[10px] font-normal text-slate-700" title={`${r.from_location||'—'} → ${r.to_location||'—'}`}>{r.from_location||'—'} → {r.to_location||'—'}</div>
 <div className="mt-0.5 flex gap-1"><input aria-label={`Invoice number ${r.trip_no} ${r.owner_name}`} title={r.invoice_no||(selected.includes(r.id)?invoiceNumber||'Automatic shared invoice number on post':'Select rent line to apply the shared invoice number')} className="block h-4 w-1/2 min-w-0 rounded border bg-slate-50 px-0.5 !text-[10px] font-normal" placeholder="Shared invoice #" disabled value={r.invoice_no??(selected.includes(r.id)?invoiceNumber:'')}/>
 <input aria-label={`Supplier invoice reference ${r.trip_no} ${r.owner_name}`} className="block h-4 w-1/2 min-w-0 rounded border bg-slate-50 px-0.5 !text-[10px] font-normal" placeholder="Shared supplier ref" disabled value={selected.includes(r.id)?supplierReference:''}/></div>
 <input aria-label={`Description ${r.trip_no} ${r.owner_name}`} title="Optional invoice description; Trip details are added automatically" className="mt-0.5 block h-5 w-full min-w-0 rounded border bg-white px-1 py-0 !text-[10px] font-normal" maxLength={2000} placeholder="Description (optional)" disabled={locked||!permissions.rent||busy||loading} value={descriptions[r.id]??''} onChange={e=>setDescriptions(v=>({...v,[r.id]:e.target.value}))}/>
  </td><td className="whitespace-nowrap">{formatTripDate(r.trip_date)}</td><td><span className="rounded bg-slate-100 px-1 py-0.5 font-medium">{r.trip_status||'—'||'—'}</span></td><td className="pr-1"><span className="block max-h-[30px] overflow-hidden leading-[15px]">{r.customer_name||'—'}</span></td><td className="pr-1"><span className="block max-h-[30px] overflow-hidden leading-[15px]">{r.from_location||'—'} → {r.to_location||'—'}{Number(r.supplier_charges??0)>0?<> · <strong>{r.supplier_charge_names||'Charge'} {financialNumber(r.supplier_charges)}</strong></>:null}</span></td><td>{r.vehicle_no||'—'}</td><td className="truncate pr-0.5" title={r.driver_name||''}>{r.driver_name||'—'}</td><td className="truncate pr-1" title={r.po_do_job_no||''}>{r.po_do_job_no||'—'}</td><td className="truncate pr-1" title={r.owner_name||supplierName}>{r.owner_name||supplierName||'—'}</td><td><input aria-label={`Rent ${r.trip_no} ${r.owner_name}`} className="input h-[30px] w-full px-1 py-0 !text-[12px] !leading-[15px]" type="number" min="0.01" step="0.01" disabled={loading||!permissions.rent||locked||busy} value={posted?String(r.billed_supplier_net??''):amounts[r.id]??String(supplierBase(ex,r.supplier_rent??r.owner_rent,r.supplier_charges??0))} onChange={e=>setAmounts(v=>({...v,[r.id]:e.target.value}))}/></td><td><div className="flex flex-col items-start gap-0.5"><span className="font-semibold tabular-nums" title={r.supplier_charge_names||''}>{financialNumber(r.supplier_charges??0)}</span>{ex&&<button type="button" className="btn h-5 px-1 text-[9px]" disabled={busy||locked} onClick={()=>setChargeRent({rent:ex,tripNo:r.trip_no})}>Charges</button>}</div></td><td className="text-[10px] tabular-nums">{selected.includes(r.id)&&existing.get(r.id)?.state==='finalized'&&!unavailableTripIds.has(r.id)?(vatRate===null?'VAT …':<><span className="block text-slate-500">{vatRate}%</span>{financialNumber(Math.round(Number(existing.get(r.id)?.finalized_amount_snapshot??existing.get(r.id)?.amount??0)*vatRate)/100)}</>):'—'}</td><td>{legacyBlocked?<span data-rate-status className="font-medium text-[10px] leading-tight text-red-700">Legacy Rent — Correction Required</span>:posted?<div className="flex flex-col items-start gap-0 leading-[13px]"><span data-rate-status className="text-[10px] leading-tight text-emerald-700">Posted {financialNumber(r.billed_supplier_net)}</span>{ex&&<button type="button" className="text-[10px] font-semibold text-blue-700 underline" disabled={busy||loading||!permissions.adjustment} onClick={()=>{setCorrectionTrip(r);setCorrectionRent(ex);setCorrectionAmount(String(r.billed_supplier_net??ex.amount));setReason('')}}>Correct Rent</button>}</div>:draftLinkedTripIds.has(r.id)?<span data-rate-status className="font-medium text-[10px] leading-tight text-amber-700">Draft invoice — {r.invoice_no||'review in Draft Invoices'}</span>:ex?.state==='finalized'?<span data-rate-status className="font-medium text-[10px] leading-tight text-blue-700">Finalized — Editable Until Post</span>:ex?<span data-rate-status className="font-medium text-[10px] leading-tight text-amber-700">Pending — Ready to Finalize</span>:<span data-rate-status className="text-[10px] leading-tight text-amber-700">Pending — Ready to Finalize</span>}</td></tr></>})}</tbody></table></div>
  <TransportPagination page={page} pageSize={500} count={pageMeta.count} busy={loading||busy} onPage={setPage}/>
  <p className="shrink-0 text-[10px] text-slate-500">All filtered rows: {pageMeta.count.toLocaleString()} · Total amount: {financialNumber(pageMeta.amount)}. Selection applies to this page.</p>
  {correctionTrip&&correctionRent&&<div className="shrink-0 border-t bg-amber-50 p-2 text-[10px]"><div className="flex flex-wrap items-end gap-2"><strong>{correctionTrip.trip_no} · Posted Rent Correction</strong><span>Current: {financialNumber(correctionTrip.billed_supplier_net)}</span><label>New Rent <input className="input h-7 w-28 px-1 text-[11px]" type="number" min="0" step="0.01" disabled={busy} value={correctionAmount} onChange={e=>setCorrectionAmount(e.target.value)}/></label><TransportReasonSelect className="min-w-[220px] flex-1" compact label="Correction Reason" kind="supplier_rate" value={reason} onChange={setReason} disabled={busy}/><button className="btn-primary h-7" disabled={loading||!permissions.adjustment||busy||!reason.trim()||!validBulkMoney(correctionAmount)||Number(correctionAmount)===correctionRent.amount} onClick={()=>void correctPostedRent()}>Save Correction</button><button className="btn h-7" disabled={busy||loading||!permissions.adjustment} onClick={()=>{setCorrectionTrip(null);setCorrectionRent(null);setCorrectionAmount('')}}>Cancel</button></div><p className="mt-1 text-slate-600">Original posted bill/payment history stays unchanged; NAVILO posts only the difference as a canonical AP adjustment.</p></div>}
  <div className="mt-2 flex shrink-0 items-center justify-between gap-2 text-[9px]"><strong>{selected.length} rent line(s) selected</strong><div className="flex gap-2"><button className="btn" disabled={loading||busy||!selected.some(canFinalize)||!reason.trim()||selected.some(id=>!existing.has(id)&&!supplier)} onClick={()=>void runBatch('finalize')}>{busy?'Working…':'Finalize Selected'}</button><button className="btn-primary" disabled={loading||!permissions.rent||busy||!account||!date||!selected.some(id=>!unavailableTripIds.has(id)&&existing.get(id)?.state==='finalized')} onClick={()=>void runBatch('draft')}>{busy?'Saving…':'Save Draft Invoice'}</button></div></div>
 {chargeRent&&<TransportSupplierCharges rentId={chargeRent.rent.id} tripNo={chargeRent.tripNo} onClose={()=>setChargeRent(null)} onChanged={async()=>{await onChanged();await load()}}/>}
 </section></TransportDialog>;
}
