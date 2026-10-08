import NaviloSearchableSelect from "@/components/SearchableSelect";
import ConfigurableReport from './ConfigurableReport';
import TransportTripReports from './TransportTripReports';
import TransportDriverPayUpload from './TransportDriverPayUpload';
import TransportDriverMonthlyKhata from './TransportDriverMonthlyKhata';
import {formatNaviloDate} from '@/lib/naviloDate';
import NaviloDateInput from '@/components/NaviloDateInput';
import {useTransportOutputPermissions} from './useTransportOutputPermissions';
import {useEffect,useMemo,useRef,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import {fetchAllPages} from '@/lib/fetchAllPages';
import {statement,type PartyMovement} from './transportPartyReporting';
import {exportPartyReport,type ReportTable} from './transportPartyExport';
import {financialNumber} from './transportFinancialTypes';
type Contribution={event_id:string;account_id:string;account_name:string;event_date:string;trip_no:string;entry_no:string;category:string;expense_accounts:string;revenue:number;cost:number};
type AccountMovement=PartyMovement & {employee_id?:string;account_id:string;account_name:string};
export default function TransportAccountStatement({kind,onChanged}:{kind:'driver'|'vehicle';onChanged?:()=>void}){
 const outputAllowed=useTransportOutputPermissions();
 const {activeCompany,activeBusinessUnit}=useAuth();
 const [contributions,setContributions]=useState<Contribution[]>([]);
 const [rows,setRows]=useState<AccountMovement[]>([]);const [account,setAccount]=useState('');const [side,setSide]=useState('supplier');
 const [from,setFrom]=useState('');const [to,setTo]=useState(new Date().toISOString().slice(0,10));const [error,setError]=useState('');const [loading,setLoading]=useState(false);
 const [revision,setRevision]=useState(0);const generation=useRef(0);const [showTripDetails,setShowTripDetails]=useState(false);
 useEffect(()=>{
 const token=++generation.current;setLoading(true);setRows([]);setContributions([]);setAccount('');setError('');
 async function load(){try{
 let data:AccountMovement[];let economics:Contribution[]=[];
 if(kind==='driver'){
 const items=await fetchAllPages<PartyMovement & {employee_id:string}>((start,end)=>supabase.rpc('transport_account_report_page',{p_kind:'driver',p_limit:end-start+1,p_offset:start}));
 data=items.map(r=>({...r,side:'supplier',party_id:r.employee_id,account_id:r.employee_id,account_name:r.party_name}));
 }else{
 [data,economics]=await Promise.all([fetchAllPages<AccountMovement>((start,end)=>supabase.rpc('transport_account_report_page',{p_kind:'vehicle',p_limit:end-start+1,p_offset:start})),fetchAllPages<Contribution>((start,end)=>supabase.rpc('transport_account_report_page',{p_kind:'contributions',p_limit:end-start+1,p_offset:start}))]);
 }
 if(generation.current===token){setRows(data);setContributions(economics);}
 }catch(e:any){if(generation.current===token)setError(e?.message||'Unable to load posted account detail.')}finally{if(generation.current===token)setLoading(false)}}
 void load();return()=>{generation.current++};
 },[kind,activeCompany?.company_id,activeBusinessUnit?.business_unit_id]);
 const accounts=useMemo(()=>Array.from(new Map([...rows,...contributions].map(r=>[r.account_id,r.account_name])).entries()).sort((a,b)=>a[1].localeCompare(b[1])),[rows,contributions]);
 const ledger=statement(rows.filter(r=>r.account_id===account&&(kind==='driver'||r.side===side)),from,to);
 const name=accounts.find(a=>a[0]===account)?.[1]||'';
 const report:ReportTable={title:`Transport ${kind==='vehicle'?'Company Vehicle':'driver'} account — ${name}`,description:`${activeCompany?.company_name||''} / ${activeBusinessUnit?.business_unit_name||''} / active branch · ${from?formatNaviloDate(from):'Beginning'} to ${to?formatNaviloDate(to):'all dates'} · Company base currency. ${kind==='driver'?'Canonical payroll shares only; positive balance is payable to the employee.':'Posted '+side+' document movements attributed to the saved vehicle assignment at original bill posting; positive balance is '+(side==='supplier'?'payable.':'receivable.')}`,
 columns:['Date','Trip','Event','Voucher','Description','Debit','Credit','Running balance'],rows:[['Opening','','','','',0,0,ledger.opening],...ledger.rows.map(r=>[formatNaviloDate(r.event_date),r.trip_no||'',r.event_type||'',r.entry_no,r.description||'',Number(r.debit),Number(r.credit),r.running]),['Closing','','','','',ledger.debit,ledger.credit,ledger.closing]]};
 const economicRows=contributions.filter(r=>r.account_id===account&&(!from||r.event_date>=from)&&(!to||r.event_date<=to));
 const revenue=economicRows.reduce((s,r)=>s+Number(r.revenue),0);const cost=economicRows.reduce((s,r)=>s+Number(r.cost),0);
 const economicReport:ReportTable={title:`Vehicle earnings and costs — ${name}`,description:`${activeCompany?.company_name||''} / ${activeBusinessUnit?.business_unit_name||''} / active branch · ${from?formatNaviloDate(from):'Beginning'} to ${to?formatNaviloDate(to):'all dates'} · Posted amounts excluding VAT, attributed to the saved assignment at source posting. Payroll viewing permission is required for driver costs. Settlements do not count as earnings or costs.`,columns:['Date','Trip','Voucher','Category','Expense account','Revenue','Cost','Contribution','Margin %'],rows:[...economicRows.map(r=>[formatNaviloDate(r.event_date),r.trip_no,r.entry_no,r.category,r.expense_accounts,Number(r.revenue),Number(r.cost),Number(r.revenue)-Number(r.cost),Number(r.revenue)?(Number(r.revenue)-Number(r.cost))/Number(r.revenue)*100:0]),['Total','','','','',revenue,cost,revenue-cost,revenue?(revenue-cost)/revenue*100:0]]};
 async function output(format:'print'|'pdf'|'xlsx',table:ReportTable=report){if(!(format==='print'?outputAllowed.print:outputAllowed.export))return;try{await exportPartyReport(table,format)}catch(e:any){setError(e?.message||'Export failed')}}
 return <div className="my-3 rounded border p-3" aria-label={`${kind} dated statement`}>
 <h3 className="font-semibold">Dated statement / opening and running balance</h3><details onToggle={e=>setShowTripDetails(e.currentTarget.open)}><summary>Trip details, earnings and margin</summary>{showTripDetails&&<TransportTripReports key={revision} accountKind={kind} accountId={account} externalFilters={{from,to,search:''}}/>}</details>{kind==='driver'&&<><TransportDriverMonthlyKhata employeeId={account} employeeName={name} onChanged={()=>{setRevision(r=>r+1);onChanged?.()}}/><TransportDriverPayUpload onChanged={()=>{setRevision(r=>r+1);onChanged?.()}}/></>}
 <div className="my-2 flex flex-wrap gap-2"><label>{kind==='driver'?'Company employee / driver':'Company vehicle'}<NaviloSearchableSelect nativeCompatibility preserveLabel className="input" value={account} onChange={e=>setAccount(e.target.value)}><option value="">Select account</option>{accounts.map(([id,label])=><option key={id} value={id}>{accounts.filter(a=>a[1]===label).length>1?`${label} · ${id.slice(0,8)}`:label}</option>)}</NaviloSearchableSelect></label>
 {kind==='vehicle'&&<label>Balance side<NaviloSearchableSelect nativeCompatibility preserveLabel className="input" value={side} onChange={e=>setSide(e.target.value)}><option value="supplier">Supplier payable</option><option value="customer">Customer receivable</option></NaviloSearchableSelect></label>}
 <label>From<NaviloDateInput className="input" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To<NaviloDateInput className="input" type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>
 {loading&&<p role="status">Loading posted account movements…</p>}{error&&<p role="alert" className="text-red-700">{error}</p>}
 {from&&to&&from>to?<p role="alert">From must be on or before To.</p>:account&&!loading&&!error&&<>{kind==='vehicle'&&<details className="mb-3 rounded border p-2" open><summary className="font-semibold">Vehicle earnings and costs · Revenue {financialNumber(revenue)} · Cost {financialNumber(cost)} · Contribution {financialNumber(revenue-cost)}</summary><p className="my-2">{economicReport.description}</p><ConfigurableReport outputPrefix="Earnings " report={economicReport} preferenceKey={`${activeCompany?.company_id}:${kind}:earnings`}/></details>}<p>{report.description}</p><ConfigurableReport report={report} preferenceKey={`${activeCompany?.company_id}:${kind}:ledger`}/></>}
 <p className="mt-2 text-slate-600">{kind==='driver'?'Statements retain the original payroll employee when assignments change. Payroll viewing permission is required.':'Gari Hisaab is limited to company-owned vehicles. Supplier/third-party vehicles remain in normal Trip, Supplier Rent, Purchase/AP and Supplier Settlement flows, but do not get a Gari Hisaab. Customer and supplier document effects for company vehicles remain separated and historical saved assignment is preserved.'}</p>
 </div>;
}
