import {useEffect,useMemo,useRef,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import {formatNaviloDate} from '@/lib/naviloDate';
import NaviloSearchableSelect from '@/components/SearchableSelect';
import ConfigurableReport from './ConfigurableReport';
import type {ReportTable} from './transportPartyExport';

type Side='customer'|'supplier';
type FilterKind='mismatch'|'all';
type VatEvidenceRow={
 document_id:string;invoice_no:string;invoice_date:string;party_name:string;
 posted_mode:string;current_mode:string;trip_mode:string;linked_net:number;linked_vat:number;
 invoice_total:number;paid:number;outstanding:number;trip_count:number;tax_percent:number;mode_diff:boolean;
};
type VatEvidence={rows:VatEvidenceRow[];count:number;linked_net:number;linked_vat:number;invoice_total:number};
const empty:VatEvidence={rows:[],count:0,linked_net:0,linked_vat:0,invoice_total:0};
const pageSize=100;
function validResult(value:unknown):value is VatEvidence{
 if(!value||typeof value!=='object')return false;
 const x=value as Record<string,unknown>;
 return Array.isArray(x.rows)&&Number.isSafeInteger(Number(x.count))&&Number(x.count)>=0
  &&[x.linked_net,x.linked_vat,x.invoice_total].every(n=>n!==null&&n!==undefined&&Number.isFinite(Number(n)));
}
function makeReport(rows:VatEvidenceRow[],totals:VatEvidence,side:Side,kind:FilterKind,search:string):ReportTable{
 const n=(x:unknown)=>Number(x??0);
 return {
  title:'Transport '+(side==='customer'?'Customer':'Supplier')+' Billing Mode & VAT Evidence Review',
  description:'READ ONLY. Posting mode is the invoice snapshot; current master mode may have changed later. Customer Trip mode is operational evidence; supplier rows show the current supplier master setting. A difference is NOT proof of a tax error. Net and VAT are linked line snapshots, while invoice total is the posted document snapshot. All totals cover the entire active filter. NO VAT additions, reposting, number changes or master updates. Filter: '+kind+', search '+(search||'all')+'.',
  columns:['Invoice Date','Invoice No','Party','Posted Mode','Current Master Mode','Trip Mode','Linked Trips','Tax %','Linked Net','Linked VAT','Posted Total','Paid','Outstanding','Mode Difference'],
  rows:[
   ...rows.map(x=>[formatNaviloDate(x.invoice_date),x.invoice_no,x.party_name,x.posted_mode,x.current_mode||'Not set',x.trip_mode||'',n(x.trip_count),n(x.tax_percent),n(x.linked_net),n(x.linked_vat),n(x.invoice_total),n(x.paid),n(x.outstanding),x.mode_diff?'Review':'—']),
   ['TOTAL · full filter','','','','','','','',n(totals.linked_net),n(totals.linked_vat),n(totals.invoice_total),'','',''],
  ]
 };
}
export default function TransportBillingModeVatReview(){
 const {activeCompany,activeBusinessUnit,accessContext}=useAuth();
 const scope=accessContext as unknown as {current_operating_location?:{id?:string;operating_location_id?:string};operating_location_id?:string}|null;
 const branch=scope?.current_operating_location?.id??scope?.current_operating_location?.operating_location_id??scope?.operating_location_id??'';
 const company=activeCompany?.company_id??'',unit=activeBusinessUnit?.business_unit_id??'';
 const [side,setSide]=useState<Side>('customer'),[kind,setKind]=useState<FilterKind>('mismatch'),[search,setSearch]=useState(''),[page,setPage]=useState(0);
 const [data,setData]=useState<VatEvidence>(empty),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const generation=useRef(0);
 const filters=useMemo(()=>({p_side:side,p_kind:kind,p_search:search.trim(),p_limit:pageSize,p_offset:page*pageSize}),[side,kind,search,page]);
 useEffect(()=>{
  const token=++generation.current;setLoading(true);setError('');setData(empty);
  if(!company||!unit||!branch){setError('Active company, business unit and operating location required');setLoading(false);return()=>{generation.current++}};
  const timer=window.setTimeout(()=>{
   void supabase.rpc('transport_billing_mode_vat_review',filters).then(({data:response,error:failure})=>{
    if(token!==generation.current)return;
    if(failure||!validResult(response)||response.rows.length>pageSize||response.rows.length>Number(response.count)){
     setError(failure?.message??'Incomplete billing-mode evidence: totals withheld.');
    }else{
     setData({...response,count:Number(response.count),linked_net:Number(response.linked_net),linked_vat:Number(response.linked_vat),invoice_total:Number(response.invoice_total)});
    }
    setLoading(false);
   },e=>{if(token===generation.current){setError(e instanceof Error?e.message:'Review unavailable');setLoading(false)}});
  },200);
  return()=>{window.clearTimeout(timer);generation.current++};
 },[company,unit,branch,filters]);
 const report=makeReport(data.rows,data,side,kind,search);
 const loadExport=async()=>{
  const rows:VatEvidenceRow[]=[];let full:VatEvidence|null=null;
  for(let offset=0;;offset+=pageSize){
   const r=await supabase.rpc('transport_billing_mode_vat_review',{...filters,p_offset:offset,p_limit:pageSize});
   if(r.error)throw r.error;
   if(!validResult(r.data)||r.data.rows.length>pageSize)throw new Error('Incomplete VAT mode review; no export generated.');
   if(full&&(Number(full.count)!==Number(r.data.count)||Number(full.linked_net)!==Number(r.data.linked_net)||Number(full.linked_vat)!==Number(r.data.linked_vat)||Number(full.invoice_total)!==Number(r.data.invoice_total)))throw new Error('Review changed during export; refresh.');
   full=full??r.data;rows.push(...r.data.rows);
   if(rows.length>25000)throw new Error('Narrow the review to fewer than 25,000 records.');
   if(rows.length>=Number(r.data.count)||r.data.rows.length===0)break;
  }
  if(!full||rows.length!==Number(full.count))throw new Error('Incomplete VAT mode review; no export generated.');
  return makeReport(rows,full,side,kind,search);
 };
 return <div className="space-y-2 rounded border p-3">
  <h2 className="text-sm font-bold">Billing Mode &amp; VAT Evidence Review</h2>
  <p className="text-xs text-slate-600">Read-only differences between invoice mode, current master mode and Trip mode. VAT changes require original dated evidence; the report never edits posted accounting.</p>
  <div className="flex flex-wrap items-end gap-2">
   <label className="text-xs">Side
    <NaviloSearchableSelect nativeCompatibility className="input block" value={side} onChange={e=>{setSide(e.target.value as Side);setPage(0)}}>
     <option value="customer">Customer</option><option value="supplier">Supplier</option>
    </NaviloSearchableSelect>
   </label>
   <label className="text-xs">View
    <NaviloSearchableSelect nativeCompatibility className="input block" value={kind} onChange={e=>{setKind(e.target.value as FilterKind);setPage(0)}}>
     <option value="mismatch">Mode differences only</option><option value="all">All posted linked invoices</option>
    </NaviloSearchableSelect>
   </label>
   <label className="text-xs">Invoice / party search
    <input className="input block w-60" value={search} maxLength={100} onChange={e=>{setSearch(e.target.value);setPage(0)}} placeholder="Invoice or party name"/>
   </label>
  </div>
  {error&&<p role="alert" className="text-red-700">{error}</p>}
  {loading?<p role="status">Loading billing-mode evidence…</p>:!error&&<>
   <div className="flex flex-wrap gap-3 text-xs">
    <span>{data.count} matching invoices</span><span>Linked net: {data.linked_net.toFixed(2)}</span><span>Linked VAT: {data.linked_vat.toFixed(2)}</span><span>Posted invoices: {data.invoice_total.toFixed(2)}</span>
   </div>
   <div className="flex items-center gap-2 text-xs">
    <button className="btn" disabled={page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}>Previous 100</button>
    <span>{data.count===0?0:page*pageSize+1}–{Math.min((page+1)*pageSize,data.count)} / {data.count}</span>
    <button className="btn" disabled={(page+1)*pageSize>=data.count} onClick={()=>setPage(p=>p+1)}>Next 100</button>
   </div>
   <ConfigurableReport report={report} loadExport={loadExport} preferenceKey={company+':'+unit+':transport-billing-mode-vat:'+side}/>
  </>}
 </div>;
}
