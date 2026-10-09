import TransportVehicleMonthlyProfitHistory from "./TransportVehicleMonthlyProfitHistory";
import ImportedAccountBalances from "@/components/ImportedAccountBalances";
import {vehicleDisplayLabel} from "@/lib/transportVehicleLabel";
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
 const [driverOptions,setDriverOptions]=useState<[string,string][]>([]);
 const [fleetOptions,setFleetOptions]=useState<[string,string][]>([]);
 const [contributions,setContributions]=useState<Contribution[]>([]);
 const [rows,setRows]=useState<AccountMovement[]>([]);const [account,setAccount]=useState('');const [side,setSide]=useState('supplier');
 const [from,setFrom]=useState('');const [to,setTo]=useState(new Date().toISOString().slice(0,10));const [error,setError]=useState('');const [loading,setLoading]=useState(false);
 const [revision,setRevision]=useState(0);const generation=useRef(0);const [showTripDetails,setShowTripDetails]=useState(false);
 useEffect(()=>{
 const token=++generation.current;setLoading(true);setRows([]);setContributions([]);setDriverOptions([]);setFleetOptions([]);setError('');
 async function load(){try{
 if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id)return;
 let data:AccountMovement[];let economics:Contribution[]=[];let fleet:[string,string][]=[];
 if(kind==='driver'){
 const drivers=await fetchAllPages<any>((a,b)=>supabase.from('transport_drivers').select('employee_id,driver_name').eq('company_id',activeCompany!.company_id).eq('business_unit_id',activeBusinessUnit!.business_unit_id).eq('is_active',true).eq('driver_type','company').is('supplier_id',null).order('id').range(a,b));if(generation.current===token)setDriverOptions(drivers.filter(d=>d.employee_id).map(d=>[d.employee_id,d.driver_name]));
 const items=await fetchAllPages<PartyMovement & {employee_id:string}>((start,end)=>supabase.rpc('transport_account_report_page',{p_kind:'driver',p_limit:end-start+1,p_offset:start}));
 data=items.map(r=>({...r,side:'supplier',party_id:r.employee_id,account_id:r.employee_id,account_name:r.party_name}));
 }else{
 // Historical opening profits may exist even before the first Trip.
 // Probe the narrow base table before invoking two costly accounting views.
 const tripProbe=await supabase.from('transport_trips').select('id')
   .eq('company_id',activeCompany.company_id)
   .eq('business_unit_id',activeBusinessUnit.business_unit_id).range(0,0);
 if(tripProbe.error)throw tripProbe.error;
 const hasTrips=(tripProbe.data??[]).length>0;
 const [movements,contribs,masterRows,truckTypes]=await Promise.all([
   hasTrips?fetchAllPages<AccountMovement>((start,end)=>supabase.rpc('transport_account_report_page',{p_kind:'vehicle',p_limit:end-start+1,p_offset:start})):Promise.resolve([] as AccountMovement[]),
   hasTrips?fetchAllPages<Contribution>((start,end)=>supabase.rpc('transport_account_report_page',{p_kind:'contributions',p_limit:end-start+1,p_offset:start})):Promise.resolve([] as Contribution[]),
   fetchAllPages<{id:string;vehicle_no:string;truck_type_id:string|null;truck_type:string|null}>((start,end)=>supabase.from('transport_vehicles')
     .select('id,vehicle_no,truck_type_id,truck_type').eq('ownership_type','company').order('vehicle_no').range(start,end)),
   fetchAllPages<{id:string;name:string}>((start,end)=>supabase.from('transport_truck_types')
     .select('id,name').order('id').range(start,end))
 ]);
 data=movements;economics=contribs;fleet=masterRows.map(v=>[v.id,vehicleDisplayLabel(v.vehicle_no,truckTypes.find(t=>t.id===v.truck_type_id)?.name??v.truck_type)] as [string,string]);
 }
 if(generation.current===token){setRows(data);setContributions(economics);setFleetOptions(fleet);}
 }catch(e:any){if(generation.current===token)setError(e?.message||'Unable to load posted account detail.')}finally{if(generation.current===token)setLoading(false)}}
 void load();return()=>{generation.current++};
 },[kind,activeCompany?.company_id,activeBusinessUnit?.business_unit_id,revision]);
 useEffect(()=>setAccount(''),[kind,activeCompany?.company_id,activeBusinessUnit?.business_unit_id]);
 const accounts=useMemo(()=>Array.from(new Map([
   ...driverOptions,...[...rows,...contributions].map(r=>[r.account_id,r.account_name] as [string,string]),
   ...(kind==='vehicle'?fleetOptions:[])
 ]).entries()).sort((a,b)=>a[1].localeCompare(b[1])),[rows,contributions,driverOptions,fleetOptions,kind]);
 const ledger=statement(rows.filter(r=>r.account_id===account&&(kind==='driver'||r.side===side)),from,to);
 const name=accounts.find(a=>a[0]===account)?.[1]||'';
 const report:ReportTable={title:`Transport ${kind==='vehicle'?'Company Vehicle':'driver'} account — ${name}`,description:`${activeCompany?.company_name||''} / ${activeBusinessUnit?.business_unit_name||''} / active branch · ${from?formatNaviloDate(from):'Beginning'} to ${to?formatNaviloDate(to):'all dates'} · Company base currency. ${kind==='driver'?'Opening salary balance + posted basic salary/trip earnings − salary payments. Positive is salary payable; negative is salary advance.':'Posted '+side+' document movements attributed to the saved vehicle assignment at original bill posting; positive balance is '+(side==='supplier'?'payable.':'receivable.')}`,
 columns:['Date','Trip','Event','Voucher','Description','Debit','Credit','Running balance'],rows:[['Opening','','','','',0,0,ledger.opening],...ledger.rows.map(r=>[formatNaviloDate(r.event_date),r.trip_no||'',r.event_type||'',r.entry_no,r.description||'',Number(r.debit),Number(r.credit),r.running]),['Closing','','','','',ledger.debit,ledger.credit,ledger.closing]]};
 const economicRows=contributions.filter(r=>r.account_id===account&&(!from||r.event_date>=from)&&(!to||r.event_date<=to));
 const revenue=economicRows.reduce((s,r)=>s+Number(r.revenue),0);const cost=economicRows.reduce((s,r)=>s+Number(r.cost),0);
 const economicReport:ReportTable={title:`Vehicle earnings and costs — ${name}`,description:`${activeCompany?.company_name||''} / ${activeBusinessUnit?.business_unit_name||''} / active branch · ${from?formatNaviloDate(from):'Beginning'} to ${to?formatNaviloDate(to):'all dates'} · Posted amounts excluding VAT, attributed to the saved assignment at source posting. Payroll viewing permission is required for driver costs. Settlements do not count as earnings or costs.`,columns:['Date','Trip','Voucher','Category','Expense account','Revenue','Cost','Contribution','Margin %'],rows:[...economicRows.map(r=>[formatNaviloDate(r.event_date),r.trip_no,r.entry_no,r.category,r.expense_accounts,Number(r.revenue),Number(r.cost),Number(r.revenue)-Number(r.cost),Number(r.revenue)?(Number(r.revenue)-Number(r.cost))/Number(r.revenue)*100:0]),['Total','','','','',revenue,cost,revenue-cost,revenue?(revenue-cost)/revenue*100:0]]};
 async function output(format:'print'|'pdf'|'xlsx',table:ReportTable=report){if(!(format==='print'?outputAllowed.print:outputAllowed.export))return;try{await exportPartyReport(table,format)}catch(e:any){setError(e?.message||'Export failed')}}
 return <div className="my-3 rounded border p-3" aria-label={`${kind} dated statement`}>
 {kind==='vehicle'&&<TransportVehicleMonthlyProfitHistory onLinked={()=>setRevision(r=>r+1)}/>}
 {kind==='driver'&&<details><summary>All driver opening balances</summary><ImportedAccountBalances kind="driver" to={to} onLinked={()=>setRevision(r=>r+1)}/></details>}
 <div className="my-2 flex flex-wrap gap-2"><label>{kind==='driver'?'Company employee / driver':'Company vehicle'}<NaviloSearchableSelect nativeCompatibility preserveLabel className="input" value={account} onChange={e=>setAccount(e.target.value)}><option value="">Select account</option>{accounts.map(([id,label])=><option key={id} value={id}>{accounts.filter(a=>a[1]===label).length>1?`${label} · ${id.slice(0,8)}`:label}</option>)}</NaviloSearchableSelect></label>
 {kind==='vehicle'&&<label>Document balance side<NaviloSearchableSelect nativeCompatibility preserveLabel className="input" value={side} onChange={e=>setSide(e.target.value)}><option value="supplier">Supplier payable</option><option value="customer">Customer receivable</option></NaviloSearchableSelect></label>}
 <label>From<NaviloDateInput className="input" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To<NaviloDateInput className="input" type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>
 <h3 className="font-semibold">Account details</h3><details onToggle={e=>setShowTripDetails(e.currentTarget.open)}><summary>Trip details, earnings and margin</summary>{showTripDetails&&<TransportTripReports key={revision} accountKind={kind} accountId={account} externalFilters={{from,to,search:''}}/>}</details>{kind==='driver'&&<><TransportDriverMonthlyKhata employeeId={account} employeeName={name} onChanged={()=>{setRevision(r=>r+1);onChanged?.()}}/><TransportDriverPayUpload onChanged={()=>{setRevision(r=>r+1);onChanged?.()}}/></>}
 {loading&&<p role="status">Loading posted account movements…</p>}{error&&<p role="alert" className="text-red-700">{error}</p>}
 {from&&to&&from>to?<p role="alert">From must be on or before To.</p>:account&&!loading&&!error&&<>{kind==='vehicle'&&<details className="mb-3 rounded border p-2"><summary className="font-semibold">Vehicle earnings and costs · Revenue {financialNumber(revenue)} · Cost {financialNumber(cost)} · Contribution {financialNumber(revenue-cost)}</summary><p className="my-2">{economicReport.description}</p><ConfigurableReport outputPrefix="Earnings " report={economicReport} preferenceKey={`${activeCompany?.company_id}:${kind}:earnings`}/></details>}<p>{report.description}</p><details><summary>Running ledger · opening, entries and closing balance</summary><ConfigurableReport report={report} preferenceKey={`${activeCompany?.company_id}:${kind}:ledger`}/></details></>}
 <p className="mt-2 text-slate-600">{kind==='driver'?'Statements retain the original payroll employee when assignments change. Payroll viewing permission is required.':'Company Vehicle Ledger is limited to company-owned vehicles. Supplier/third-party vehicles remain in normal Trip, Supplier Rent, Purchase/AP and Supplier Settlement flows, but do not get a Company Vehicle Ledger. Customer and supplier document effects for company vehicles remain separated and historical saved assignment is preserved.'}</p>
 </div>;
}
