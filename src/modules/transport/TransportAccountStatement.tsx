import {useEffect,useMemo,useRef,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import {fetchAllPages} from '@/lib/fetchAllPages';
import {statement,type PartyMovement} from './transportPartyReporting';
import {exportPartyReport,type ReportTable} from './transportPartyExport';
import {financialNumber} from './transportFinancialTypes';
type AccountMovement=PartyMovement & {employee_id?:string;account_id:string;account_name:string};
export default function TransportAccountStatement({kind}:{kind:'driver'|'vehicle'}){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const [rows,setRows]=useState<AccountMovement[]>([]);const [account,setAccount]=useState('');const [side,setSide]=useState('supplier');
 const [from,setFrom]=useState('');const [to,setTo]=useState(new Date().toISOString().slice(0,10));const [error,setError]=useState('');const [loading,setLoading]=useState(false);
 const generation=useRef(0);
 useEffect(()=>{
 const token=++generation.current;setLoading(true);setRows([]);setAccount('');setError('');
 async function load(){try{
 let data:AccountMovement[];
 if(kind==='driver'){
 const items=await fetchAllPages<PartyMovement & {employee_id:string}>((start,end)=>supabase.from('transport_driver_account_movements').select('*').order('event_id').range(start,end));
 data=items.map(r=>({...r,side:'supplier',party_id:r.employee_id,account_id:r.employee_id,account_name:r.party_name}));
 }else{
 const [items,trips]=await Promise.all([
 fetchAllPages<PartyMovement>((start,end)=>supabase.from('transport_party_movements').select('*').order('event_id').range(start,end)),
 fetchAllPages<{id:string;vehicle_id:string|null;vehicle_no:string|null}>((start,end)=>supabase.from('transport_financial_register').select('id,vehicle_id,vehicle_no').order('id').range(start,end))]);
 const tripMap=new Map(trips.map(t=>[t.id,t]));
 data=items.filter(r=>r.trip_ids?.length===1).flatMap(r=>{const t=tripMap.get(r.trip_ids![0]);return t?.vehicle_id?[{...r,account_id:t.vehicle_id,account_name:t.vehicle_no||t.vehicle_id}]:[]});
 }
 if(generation.current===token)setRows(data);
 }catch(e:any){if(generation.current===token)setError(e?.message||'Unable to load posted account detail.')}finally{if(generation.current===token)setLoading(false)}}
 void load();return()=>{generation.current++};
 },[kind,activeCompany?.company_id,activeBusinessUnit?.business_unit_id]);
 const accounts=useMemo(()=>Array.from(new Map(rows.map(r=>[r.account_id,r.account_name])).entries()).sort((a,b)=>a[1].localeCompare(b[1])),[rows]);
 const ledger=statement(rows.filter(r=>r.account_id===account&&(kind==='driver'||r.side===side)),from,to);
 const name=accounts.find(a=>a[0]===account)?.[1]||'';
 const report:ReportTable={title:`Transport ${kind} account — ${name}`,description:`${activeCompany?.company_name||''} / ${activeBusinessUnit?.business_unit_name||''} / active branch · ${from||'Beginning'} to ${to||'all dates'} · Company base currency. ${kind==='driver'?'Canonical payroll shares only; positive balance is payable to the employee.':'Posted '+side+' document movements for the Trip’s current vehicle assignment; positive balance is '+(side==='supplier'?'payable.':'receivable.')}`,
 columns:['Date','Trip','Event','Voucher','Description','Debit','Credit','Running balance'],rows:[['Opening','','','','',0,0,ledger.opening],...ledger.rows.map(r=>[r.event_date,r.trip_no||'',r.event_type||'',r.entry_no,r.description||'',Number(r.debit),Number(r.credit),r.running]),['Closing','','','','',ledger.debit,ledger.credit,ledger.closing]]};
 async function output(format:'print'|'pdf'|'xlsx'){try{await exportPartyReport(report,format)}catch(e:any){setError(e?.message||'Export failed')}}
 return <div className="my-3 rounded border p-3" aria-label={`${kind} dated statement`}>
 <h3 className="font-semibold">Dated statement / opening and running balance</h3>
 <div className="my-2 flex flex-wrap gap-2"><label>{kind==='driver'?'Payroll employee':'Vehicle'}<select className="input" value={account} onChange={e=>setAccount(e.target.value)}><option value="">Select account</option>{accounts.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
 {kind==='vehicle'&&<label>Balance side<select className="input" value={side} onChange={e=>setSide(e.target.value)}><option value="supplier">Supplier payable</option><option value="customer">Customer receivable</option></select></label>}
 <label>From<input className="input" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To<input className="input" type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>
 {loading&&<p role="status">Loading posted account movements…</p>}{error&&<p role="alert" className="text-red-700">{error}</p>}
 {from&&to&&from>to?<p role="alert">From must be on or before To.</p>:account&&!loading&&!error&&<><p>{report.description}</p><div className="my-2 flex gap-2">{(['print','pdf','xlsx'] as const).map(format=><button key={format} className="btn" onClick={()=>void output(format)}>{format==='xlsx'?'Excel':format.toUpperCase()}</button>)}</div><div className="max-h-80 overflow-auto"><table className="w-full whitespace-nowrap text-left"><thead><tr>{report.columns.map(c=><th className="p-2" key={c}>{c}</th>)}</tr></thead><tbody>{report.rows.map((r,i)=><tr key={i} className="border-t">{r.map((v,k)=><td className="p-2" key={k}>{typeof v==='number'?financialNumber(v):v}</td>)}</tr>)}</tbody></table></div></>}
 <p className="mt-2 text-slate-600">{kind==='driver'?'Statements retain the original payroll employee when assignments change. Payroll viewing permission is required.':'Customer and supplier balances are shown separately. Shared documents are excluded from vehicle attribution to avoid counting them twice.'}</p>
 </div>;
}
