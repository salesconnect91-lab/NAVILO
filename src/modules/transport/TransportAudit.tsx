import {useState} from 'react';
import {supabase} from '@/lib/supabase';
import {useAuth} from '@/auth/AuthContext';
import {formatNaviloDate} from '@/lib/naviloDate';

type Audit={
  id:number;
  trip_id:string;
  trip_no?:string|null;
  event_type?:string|null;
  action?:string|null;
  old_data?:unknown;
  new_data?:unknown;
  old_value?:unknown;
  new_value?:unknown;
  reason?:string|null;
  changed_by?:string|null;
  actor_id?:string|null;
  changed_at?:string|null;
  occurred_at?:string|null;
};

type TripRef={id:string;trip_no:string};

const EVENT_LABELS:Record<string,string>={
  created:'Trip Created',
  updated:'Trip Updated',
  deleted:'Trip Deleted',
  cancelled:'Trip Cancelled',
  status_change:'Trip Status Changed',
  trip_status_change:'Trip Status Changed',
  assignment_change:'Assignment Changed',
  vehicle_change:'Vehicle Changed',
  driver_change:'Driver Changed',
  customer_change:'Customer Changed',
  ppr_change:'PPR Status Changed',
  ppr_receipt_change:'PPR Receipt Changed',
  ppr_attachment_change:'PPR Attachment Changed',
  customer_rate_finalize:'Customer Rate Finalized',
  customer_rate_override:'Customer Rate Changed',
  rate_adjustment:'Customer Rate Adjustment',
  rent_finalize:'Supplier Rent Finalized',
  rent_finalized:'Supplier Rent Finalized',
  rent_correct:'Supplier Rent Corrected',
  legacy_owner_rent_retired:'Legacy Owner Rent Retired',
  supplier_bill_posted:'Supplier Bill Posted',
  customer_bill_posted:'Customer Bill Posted',
  cash_bill_received:'Cash Customer Receipt Posted'
};

const technicalKey=(key:string)=>['id','trip_id','company_id','business_unit_id'].includes(key);
const labelFor=(key:string)=>key.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
const display=(value:unknown)=>{
  if(value===null||value===undefined||value==='')return '—';
  if(typeof value==='boolean')return value?'Yes':'No';
  if(typeof value==='number')return value.toLocaleString();
  if(typeof value==='object')return JSON.stringify(value);
  return String(value);
};
const objectValue=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const changesFor=(row:Audit)=>{
  const before=row.old_data??row.old_value;
  const after=row.new_data??row.new_value;
  const oldObject=objectValue(before),newObject=objectValue(after);
  if(!oldObject&&!newObject)return display(before)===display(after)?[]:[{key:'value',before,after}];
  const keys=Array.from(new Set([...Object.keys(oldObject??{}),...Object.keys(newObject??{})]));
  return keys.filter(key=>display(oldObject?.[key])!==display(newObject?.[key]))
    .map(key=>({key,before:oldObject?.[key],after:newObject?.[key]}));
};
const eventLabel=(row:Audit)=>{
  const key=String(row.event_type||row.action||'updated').toLowerCase();
  return EVENT_LABELS[key]??labelFor(key);
};
const auditDateTime=(value:string|null|undefined)=>{
  if(!value)return '—';
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return value;
  return `${formatNaviloDate(date.toISOString().slice(0,10))} · ${date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;
};

export default function TransportAudit({trips}:{trips:TripRef[]}){
  const {activeCompany,activeBusinessUnit}=useAuth();
  const company=activeCompany?.company_id,unit=activeBusinessUnit?.business_unit_id;
  const [input,setInput]=useState('');
  const [searchedTrip,setSearchedTrip]=useState('');
  const [rows,setRows]=useState<Audit[]>([]);
  const [summary,setSummary]=useState<any|null>(null);
  const [actors,setActors]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [searched,setSearched]=useState(false);

  const runSearch=async()=>{
    const tripNo=input.trim().toUpperCase();
    if(!tripNo){setError('Enter a Trip No. to generate its audit report.');return;}
    if(!company||!unit){setError('Select Company and Business Unit.');return;}
    setBusy(true);setError('');setSearched(true);setSearchedTrip(tripNo);setRows([]);setSummary(null);setActors({});
    try{
      const [auditResult,tripResult]=await Promise.all([
        supabase.rpc('transport_audit_page',{p_limit:500,p_offset:0,p_search:tripNo}),
        supabase.rpc('transport_register_query',{p_limit:50,p_offset:0,p_filters:{search:tripNo}})
      ]);
      if(auditResult.error)throw auditResult.error;
      if(tripResult.error)throw tripResult.error;
      const exactAudit=(auditResult.data?.rows??[]).filter((row:Audit)=>String(row.trip_no??'').toUpperCase()===tripNo);
      const exactTrip=(tripResult.data?.rows??[]).find((row:any)=>String(row.trip_no??'').toUpperCase()===tripNo)??null;
      setRows(exactAudit);
      setSummary(exactTrip??trips.find(t=>t.trip_no.toUpperCase()===tripNo)??null);

      const ids=Array.from(new Set(exactAudit.map((row:Audit)=>row.changed_by??row.actor_id).filter(Boolean))) as string[];
      if(ids.length){
        const profiles=await supabase.from('user_profiles').select('id,full_name,email').in('id',ids);
        if(!profiles.error){
          setActors(Object.fromEntries((profiles.data??[]).map((profile:any)=>[
            profile.id,
            profile.full_name?.trim()||profile.email?.trim()||profile.id
          ])));
        }
      }
    }catch(e:any){
      setError(e?.message||'Unable to generate Trip audit report.');
    }finally{setBusy(false);}
  };

  const actorName=(row:Audit)=>{
    const id=row.changed_by??row.actor_id;
    return id?(actors[id]??id):'System';
  };
  const found=Boolean(summary)||rows.length>0;

  return <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
    <div className="border-b border-slate-200 px-4 py-3">
      <h2 className="text-sm font-bold text-slate-950">Trip Audit Report</h2>
      <p className="mt-0.5 text-xs text-slate-500">Enter one Trip No. to see who changed what, when it changed, and the recorded source or reason.</p>
      <form className="mt-3 flex max-w-2xl items-center gap-2" onSubmit={e=>{e.preventDefault();void runSearch();}}>
        <input
          aria-label="Trip No"
          className="input h-9 flex-1"
          value={input}
          onChange={e=>setInput(e.target.value)}
          placeholder="Trip No. e.g. OIC-000007"
          autoComplete="off"
        />
        <button type="submit" disabled={busy} className="btn-primary h-9 min-w-[120px] justify-center">
          {busy?'Generating…':'Generate Report'}
        </button>
        {(searched||input)&&<button type="button" className="btn h-9" onClick={()=>{setInput('');setSearchedTrip('');setRows([]);setSummary(null);setActors({});setError('');setSearched(false);}}>Clear</button>}
      </form>
      {error&&<p role="alert" className="mt-2 text-xs font-semibold text-red-700">{error}</p>}
    </div>

    {!searched&&!busy&&<div className="px-4 py-10 text-center">
      <div className="text-sm font-semibold text-slate-700">No Trip selected</div>
      <div className="mt-1 text-xs text-slate-500">Audit history is not dumped here. Search a Trip No. to generate its report.</div>
    </div>}

    {searched&&!busy&&!found&&!error&&<div className="px-4 py-10 text-center">
      <div className="text-sm font-semibold text-slate-700">No audit report found for {searchedTrip}</div>
      <div className="mt-1 text-xs text-slate-500">Check the Trip No. and search again.</div>
    </div>}

    {searched&&!busy&&found&&<>
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-base font-black text-slate-950">{searchedTrip}</div>
            <div className="text-xs text-slate-500">Complete recorded activity for this Trip</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
            {rows.length.toLocaleString()} recorded event{rows.length===1?'':'s'}
          </div>
        </div>

        {summary&&<div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <AuditSummary label="Trip Date" value={summary.trip_date?formatNaviloDate(summary.trip_date):'—'}/>
          <AuditSummary label="Customer" value={summary.customer_name??summary.customer_name_snapshot??'—'}/>
          <AuditSummary label="Vehicle" value={summary.vehicle_no??'—'}/>
          <AuditSummary label="Driver" value={summary.driver_name??'—'}/>
          <AuditSummary label="Owner / Supplier" value={summary.owner_name??summary.owner_name_snapshot??'—'}/>
          <AuditSummary label="Route" value={[summary.from_location,summary.to_location].filter(Boolean).join(' → ')||'—'}/>
          <AuditSummary label="Trip Status" value={summary.status??summary.trip_status??'—'}/>
          <AuditSummary label="Finance Status" value={summary.financial_status??'—'}/>
          <AuditSummary label="PPR Status" value={summary.ppr_status??'—'}/>
          <AuditSummary label="PO / DO / Job No." value={summary.po_do_job_no??'—'}/>
          <AuditSummary label="Invoice No." value={summary.invoice_no??'—'}/>
          <AuditSummary label="Sale Type" value={summary.sale_type??'—'}/>
        </div>}
      </div>

      <div className="px-4 py-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Activity Timeline</h3>
        {!rows.length&&<p className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-500">Trip exists, but no audit events are recorded for it.</p>}
        <div className="mt-2 space-y-2">
          {rows.map(row=>{
            const changes=changesFor(row);
            const eventKey=String(row.event_type||row.action||'').toLowerCase();
            const sensitive=/delete|cancel|correct|adjust|override/.test(eventKey);
            const recordedSource=objectValue(row.new_data)?.source;
            const sourceReason=row.reason??(typeof recordedSource==='string'||typeof recordedSource==='number'?String(recordedSource):'');
            return <article key={row.id} className={`rounded-lg border p-3 ${sensitive?'border-amber-200 bg-amber-50/40':'border-slate-200 bg-white'}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-slate-900">{eventLabel(row)}</div>
                  <div className="mt-0.5 text-xs text-slate-600">
                    By <span className="font-semibold text-slate-900">{actorName(row)}</span>
                    <span className="mx-1.5 text-slate-300">•</span>
                    {auditDateTime(row.changed_at??row.occurred_at)}
                  </div>
                </div>
                {sourceReason&&<div className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-700">
                  Source / Reason: <span className="font-semibold">{sourceReason}</span>
                </div>}
              </div>

              {changes.length>0&&<div className="mt-2 overflow-x-auto rounded border border-slate-200">
                <table className="w-full min-w-[560px] text-xs">
                  <thead className="bg-slate-50 text-left text-[10px] uppercase text-slate-500"><tr><th className="px-2 py-1.5">Field</th><th className="px-2 py-1.5">Before</th><th className="px-2 py-1.5">After</th></tr></thead>
                  <tbody>{changes.map(change=><tr key={change.key} className="border-t border-slate-100">
                    <td className="px-2 py-1.5 font-semibold text-slate-700">{labelFor(change.key)}</td>
                    <td className="max-w-[360px] break-words px-2 py-1.5 text-slate-600">{display(change.before)}</td>
                    <td className="max-w-[360px] break-words px-2 py-1.5 font-medium text-slate-900">{display(change.after)}</td>
                  </tr>)}</tbody>
                </table>
              </div>}

              <details className="mt-2 text-[11px] text-slate-500">
                <summary className="cursor-pointer select-none font-semibold">Technical details</summary>
                <div className="mt-1 grid gap-1 rounded bg-slate-50 p-2 sm:grid-cols-2">
                  <div>Audit ID: {row.id}</div>
                  <div>Event key: {row.event_type??row.action??'—'}</div>
                  <div>Actor ID: {row.changed_by??row.actor_id??'System'}</div>
                  <div>Trip ID: {row.trip_id}</div>
                  {changes.filter(change=>technicalKey(change.key)).map(change=><div key={change.key}>{labelFor(change.key)}: {display(change.after)}</div>)}
                </div>
              </details>
            </article>;
          })}
        </div>
      </div>
    </>}
  </section>;
}

function AuditSummary({label,value}:{label:string;value:unknown}){
  return <div className="min-w-0 rounded-md border border-slate-200 bg-white px-2.5 py-2">
    <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{label}</div>
    <div className="mt-0.5 truncate text-xs font-semibold text-slate-900" title={display(value)}>{display(value)}</div>
  </div>;
}
