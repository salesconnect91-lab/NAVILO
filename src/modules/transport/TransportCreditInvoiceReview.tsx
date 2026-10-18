import {useEffect,useMemo,useRef,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import {formatNaviloDate} from '@/lib/naviloDate';
import NaviloSearchableSelect from '@/components/SearchableSelect';
import ConfigurableReport from './ConfigurableReport';
import type {ReportTable} from './transportPartyExport';

type Lane='all'|'UNPAID_CORRECTION_CANDIDATE'|'HAS_ORIGINAL_NUMBER'|'PAYMENT_LINKED_REVIEW'|'EXISTING_CORRECTION_REVIEW'|'ACCOUNTING_MISMATCH_REVIEW';
type ReviewRow={
 sales_order_id:string;invoice_no:string;order_date:string;trip_count:number;
 total:number;paid:number;outstanding:number;allocations:number;allocated:number;
 journal_lines:number;journal_net:number;review_lane:string;
 source_reference_candidate:string|null;distinct_source_references:number;
 already_posted_reference_matches:number;different_customer_reference_matches:number;matched_posted_total:number;
 source_import_cell:string;source_import_distinct_values:number;source_import_row_first:number|null;source_import_row_last:number|null;
};
type Review={rows:ReviewRow[];count:number;gross:number;paid:number;outstanding:number};
const empty:Review={rows:[],count:0,gross:0,paid:0,outstanding:0};
const pageSize=100;
const lanes:ReadonlyArray<{value:Lane;label:string}>=[
 {value:'all',label:'All Credit invoice exceptions'},
 {value:'UNPAID_CORRECTION_CANDIDATE',label:'Unpaid — correction candidate'},
 {value:'HAS_ORIGINAL_NUMBER',label:'Source reference exists — verify'},
 {value:'PAYMENT_LINKED_REVIEW',label:'Payment-linked — manual review'},
 {value:'EXISTING_CORRECTION_REVIEW',label:'Existing correction — manual review'},
 {value:'ACCOUNTING_MISMATCH_REVIEW',label:'Accounting mismatch — manual review'},
];
function validResponse(x:unknown):x is Review{
 if(!x||typeof x!=='object')return false;
 const r=x as Record<string,unknown>;
 return Array.isArray(r.rows)&&Number.isSafeInteger(Number(r.count))&&Number(r.count)>=0
  &&[r.gross,r.paid,r.outstanding].every(n=>n!==null&&n!==undefined&&Number.isFinite(Number(n)));
}
function evidenceNextStep(row:ReviewRow):string{
 const cell=(row.source_import_cell??'').trim().toUpperCase();
 if(Number(row.already_posted_reference_matches)>0)return 'Number already posted: verify customer, Trip, amount and original document; no renaming';
 if(Number(row.source_import_distinct_values)>1)return 'Conflicting import cells: compare original spreadsheet rows';
 if(cell==='CLEARED')return 'Settlement marker: reconcile original payment and allocation evidence';
 if(cell==='NO INVOICE')return 'No invoice marker: verify if invoice was ever issued before any correction';
 if(cell==='CRN'||cell.includes('ADJUST'))return 'Adjustment marker: verify credit note or adjustment evidence';
 if(!cell)return 'Blank original number: obtain original invoice evidence, then review posting';
 if(!row.source_reference_candidate)return 'Non-invoice source note: review original evidence';
 return 'Unverified reference: compare original document before correction';
}
function reportFor(rows:ReviewRow[],totals:Review,lane:Lane,search:string,page:number):ReportTable{
 const numbers=(v:unknown)=>Number(v??0);
 return {
  title:'Transport Credit Invoice Number — Evidence Review',
  description:'Read-only correction queue for posted generated-number Credit Trip invoices. Source references are unverified evidence, NOT approved replacement numbers. Date is the recorded invoice date. Totals cover the complete active filter, not just the displayed page. No invoice renumbering, VAT correction, payment allocation or journal posting is performed. '+(lane==='all'?'All lanes':lanes.find(x=>x.value===lane)?.label)+' · '+totals.count+' invoices · '+(search?'Search: '+search:'No search')+' · Page '+(page+1),
  columns:['Invoice Date','Generated Invoice No','Source reference (unverified)','Distinct source refs','Linked Trips','Review lane','Gross','Paid','Outstanding','Allocations','Allocated','Journal lines','Journal net','Reference status','Posted invoice matches','Different-customer matches','Matched posted gross','Original import cell','Source row(s)','Original import values','Required verification'],
  rows:[
   ...rows.map(x=>[formatNaviloDate(x.order_date),x.invoice_no,x.source_reference_candidate??'',numbers(x.distinct_source_references),numbers(x.trip_count),x.review_lane,numbers(x.total),numbers(x.paid),numbers(x.outstanding),numbers(x.allocations),numbers(x.allocated),numbers(x.journal_lines),numbers(x.journal_net),
     numbers(x.distinct_source_references)>1?'Multiple source references — manual review':
     !x.source_reference_candidate?'Original reference missing':
     numbers(x.already_posted_reference_matches)>0?'NUMBER ALREADY POSTED — DO NOT RENAME':'Unverified reference — manual review',
     numbers(x.already_posted_reference_matches),numbers(x.different_customer_reference_matches),numbers(x.matched_posted_total),
     x.source_import_cell??'',x.source_import_row_first==null?'':String(x.source_import_row_first)+(x.source_import_row_last==null||x.source_import_row_last===x.source_import_row_first?'':'–'+x.source_import_row_last),
     numbers(x.source_import_distinct_values),evidenceNextStep(x)]),
   ['TOTAL · complete filter','','','','','',numbers(totals.gross),numbers(totals.paid),numbers(totals.outstanding),'','','','','','','','','','',''],
  ]
 };
}
export default function TransportCreditInvoiceReview(){
 const {activeCompany,activeBusinessUnit,accessContext}=useAuth();
 const scope=accessContext as unknown as {current_operating_location?:{id?:string;operating_location_id?:string};operating_location_id?:string}|null;
 const branch=scope?.current_operating_location?.id??scope?.current_operating_location?.operating_location_id??scope?.operating_location_id??'';
 const company=activeCompany?.company_id??'',unit=activeBusinessUnit?.business_unit_id??'';
 const [lane,setLane]=useState<Lane>('all'),[search,setSearch]=useState(''),[page,setPage]=useState(0);
 const [data,setData]=useState<Review>(empty),[busy,setBusy]=useState(true),[error,setError]=useState('');
 const request=useRef(0);
 const filters=useMemo(()=>({p_lane:lane,p_search:search.trim(),p_limit:pageSize,p_offset:page*pageSize}),[lane,search,page]);
 useEffect(()=>{
  const token=++request.current;
  setBusy(true);setError('');setData(empty);
  if(!company||!unit||!branch){setError('Active company, business unit, and operating location required.');setBusy(false);return()=>{request.current++};}
  const timer=window.setTimeout(()=>{
   void supabase.rpc('transport_credit_invoice_review',filters).then(({data:result,error:failure})=>{
    if(token!==request.current)return;
    if(failure||!validResponse(result)){
     setError(failure?.message??'Incomplete Credit invoice review; totals withheld.');
    } else if(result.rows.length>pageSize||result.rows.length>Number(result.count)){
     setError('Incomplete Credit invoice review; totals withheld.');
    } else setData({...result,count:Number(result.count),gross:Number(result.gross),paid:Number(result.paid),outstanding:Number(result.outstanding)});
    setBusy(false);
   },e=>{if(token===request.current){setError(e instanceof Error?e.message:'Review unavailable');setBusy(false);}});
  },200);
  return()=>{window.clearTimeout(timer);request.current++};
 },[company,unit,branch,filters]);
 const report=reportFor(data.rows,data,lane,search,page);
 const loadExport=async()=>{
  const rows:ReviewRow[]=[];let full:Review|null=null;
  for(let offset=0;;offset+=pageSize){
   const q=await supabase.rpc('transport_credit_invoice_review',{...filters,p_limit:pageSize,p_offset:offset});
   if(q.error)throw q.error;
   if(!validResponse(q.data))throw new Error('Incomplete invoice review export; no file generated.');
   if(full&&(Number(full.count)!==Number(q.data.count)||Number(full.gross)!==Number(q.data.gross)||Number(full.paid)!==Number(q.data.paid)||Number(full.outstanding)!==Number(q.data.outstanding)))throw new Error('Invoice review changed during export; refresh.');
   full=full??q.data;rows.push(...q.data.rows);
   if(rows.length>10000)throw new Error('Narrow invoice review before exporting more than 10,000 records.');
   if(rows.length>=Number(q.data.count)||q.data.rows.length===0)break;
  }
  if(!full||rows.length!==Number(full.count))throw new Error('Incomplete invoice review export; no file generated.');
  return reportFor(rows,full,lane,search,0);
 };
 return <div className="space-y-2 rounded border p-3">
  <h2 className="text-sm font-bold">Credit Invoice Number — Correction Review</h2>
  <p className="text-xs text-slate-600">Read-only evidence for generated H-S references. Never use an unverified source reference to rename a posted invoice. Paid invoices and journal-pair corrections require controlled accounting review.</p>
  <div className="flex flex-wrap gap-2 items-end">
   <label className="text-xs">Review lane
    <NaviloSearchableSelect nativeCompatibility className="input block min-w-56" value={lane} onChange={e=>{setLane(e.target.value as Lane);setPage(0)}}>{lanes.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</NaviloSearchableSelect>
   </label>
   <label className="text-xs">Generated / source reference search
    <input className="input block w-64" maxLength={100} value={search} onChange={e=>{setSearch(e.target.value);setPage(0)}} placeholder="Invoice reference"/>
   </label>
  </div>
  {error&&<p role="alert" className="text-red-700">{error}</p>}
  {busy?<p role="status">Loading invoice evidence…</p>:!error&&<>
   <div className="flex items-center flex-wrap gap-3 text-xs">
    <span>{data.count} matching invoices</span>
    <span>Gross: {data.gross.toFixed(2)}</span>
    <span>Paid: {data.paid.toFixed(2)}</span>
    <span>Outstanding: {data.outstanding.toFixed(2)}</span>
   </div>
   <div className="flex items-center gap-2 text-xs">
    <button className="btn" disabled={page===0} onClick={()=>setPage(x=>Math.max(0,x-1))}>Previous 100</button>
    <span>{data.count===0?0:page*pageSize+1}–{Math.min((page+1)*pageSize,data.count)} / {data.count}</span>
    <button className="btn" disabled={(page+1)*pageSize>=data.count} onClick={()=>setPage(x=>x+1)}>Next 100</button>
   </div>
   <ConfigurableReport report={report} loadExport={loadExport} preferenceKey={company+':'+unit+':transport-credit-invoice-review'}/>
  </>}
 </div>;
}
