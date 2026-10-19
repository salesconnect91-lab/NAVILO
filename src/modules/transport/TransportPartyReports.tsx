import NaviloSearchableSelect from "@/components/SearchableSelect";
import {vehicleDisplayLabel} from "@/lib/transportVehicleLabel";
import {billingReport,hasOnlyWithoutVatDocuments} from './transportBillingReports';
import TransportVatGuide from './TransportVatGuide';
import ConfigurableReport from './ConfigurableReport';
import TransportTripReports from './TransportTripReports';
import {formatNaviloDate} from '@/lib/naviloDate';
import NaviloDateInput from '@/components/NaviloDateInput';
import {useTransportOutputPermissions} from './useTransportOutputPermissions';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import {fetchAllPages} from '@/lib/fetchAllPages';
import {financialNumber} from './transportFinancialTypes';
import {cents,money,statement,documentBalances,type PartyDocument,type PartyMovement,type PartySide} from './transportPartyReporting';
import {exportPartyReport,type ReportTable} from './transportPartyExport';
import TransportAdvanceOperations from './TransportAdvanceOperations';
import TransportPartySettlement from './TransportPartySettlement';
import {linkedPartyRows} from './transportOpeningInvoices';
type Mode='trip-statement'|'trip-ledger'|'trips'|'outstanding'|'statement'|'allocations'|'canonical'|'reconciliation';
export default function TransportPartyReports({onClose,onChanged,initialSide='customer',initialPartyId='',allocationEntry=false}:{onClose:()=>void;onChanged:()=>Promise<void>;initialSide?:PartySide;initialPartyId?:string;allocationEntry?:boolean}){
 const outputAllowed=useTransportOutputPermissions();
 const {activeCompany,activeBusinessUnit,accessContext}=useAuth();const company=activeCompany?.company_id;const unit=activeBusinessUnit?.business_unit_id;
 const location=(accessContext as unknown as {current_operating_location?:{id?:string;operating_location_id?:string};operating_location_id?:string}|null);const branch=location?.current_operating_location?.id??location?.current_operating_location?.operating_location_id??location?.operating_location_id;
 const [side,setSide]=useState<PartySide>(initialSide);const [party,setParty]=useState(initialPartyId);const [mode,setMode]=useState<Mode>(allocationEntry?'allocations':'outstanding');
 const [partyMasters,setPartyMasters]=useState<Array<{side:PartySide;party_id:string;party_name:string}>>([]);
 const [tripDetails,setTripDetails]=useState<any[]>([]);const [documents,setDocuments]=useState<PartyDocument[]>([]);const [movements,setMovements]=useState<PartyMovement[]>([]);
 const [canonical,setCanonical]=useState<PartyMovement[]>([]);const [accounts,setAccounts]=useState<Array<{id:string;name:string;detail_type:string}>>([]);
 const [readSides,setReadSides]=useState({customer:false,supplier:false});const [canLedger,setCanLedger]=useState(false);const [from,setFrom]=useState('');const [to,setTo]=useState(new Date().toISOString().slice(0,10));
 const [tripSearch,setTripSearch]=useState('');const [status,setStatus]=useState('all');const [settlement,setSettlement]=useState(allocationEntry&&!!initialPartyId);const [showAdvances,setShowAdvances]=useState(false);
 const [busy,setBusy]=useState(false);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [loadAllParties,setLoadAllParties]=useState(false);const generation=useRef(0);
 // A party is required for automatic financial data retrieval. The explicit
 // all-party option remains available for users who really need that scope.
 const partyRequired=['statement','trip-statement','trip-ledger','canonical'].includes(mode);
 const readFinancial=mode!=='trips'&&Boolean(party||loadAllParties)&&(!partyRequired||Boolean(party));
 const load=useCallback(async()=>{
 if(!company||!unit)return false;const request=++generation.current;setLoading(true);setError('');
 try{
 const permission=await supabase.rpc('has_module_permission',{p_company_id:company,p_module:'accounting',p_action:'view'});
 if(permission.error)throw permission.error;const ledgerAllowed=permission.data===true;const sideReads=await Promise.all(['customer','supplier'].map(p_side=>supabase.rpc('transport_financial_read_allowed',{p_side})));for(const r of sideReads)if(r.error)throw r.error;const permitted={customer:sideReads[0].data===true,supplier:sideReads[1].data===true};const selectedSide=permitted[side]?side:permitted.customer?'customer':'supplier';setReadSides(permitted);if(!permitted[side]){if(permitted.customer)setSide('customer');else if(permitted.supplier)setSide('supplier');else throw new Error('Transport financial view permission required');}
 // Masters load on opening the panel, but invoice/ledger history only loads
 // after choosing a party or explicitly requesting the all-party report.
 const [a,customers,suppliers]=await Promise.all([
 fetchAllPages<{id:string;name:string;detail_type:string}>((start,end)=>supabase.from('chart_of_accounts').select('id,name,detail_type').eq('company_id',company).eq('is_active',true).eq('is_group',false).in('detail_type',['Cash on Hand','Bank Account']).order('id').range(start,end)),
 permitted.customer?fetchAllPages<{id:string;name:string}>((start,end)=>supabase.from('customers').select('id,name').eq('company_id',company).order('id').range(start,end)):Promise.resolve([]),
 permitted.supplier?fetchAllPages<{id:string;name:string}>((start,end)=>supabase.from('suppliers').select('id,name').eq('company_id',company).order('id').range(start,end)):Promise.resolve([])
 ]);
 if(request!==generation.current)return false;
 let d:PartyDocument[]=[],m:PartyMovement[]=[],c:PartyMovement[]=[],ct:any[]=[],st:any[]=[];
 if(readFinancial){
  const filters={party,to:mode==='reconciliation'?'':to,search:mode==='canonical'?'':tripSearch};
  // Serializing the expensive report families avoids multiple broad scans
  // competing for memory/I/O on the same Supabase instance.
  if(mode!=='canonical'){
   d=await linkedPartyRows<PartyDocument>('documents',selectedSide,filters);
   if(request!==generation.current)return false;
   m=await linkedPartyRows<PartyMovement>('movements',selectedSide,filters);
   if(request!==generation.current)return false;
  }
  if(ledgerAllowed&&(mode==='canonical'||mode==='reconciliation')){
   c=await fetchAllPages<PartyMovement>((start,end)=>supabase.rpc('transport_party_report_query',{p_kind:'canonical',p_side:selectedSide,p_filters:filters,p_limit:end-start+1,p_offset:start}));
   if(request!==generation.current)return false;
  }
  // Trip detail queries contain expensive per-document joins. Only expand
  // them for a selected party, not an unbounded all-party report.
  if(party&&mode!=='canonical'){
   ct=await fetchAllPages<any>((start,end)=>supabase.rpc('transport_document_trip_detail_query',{p_side:selectedSide,p_filters:filters,p_limit:end-start+1,p_offset:start}));
   if(request!==generation.current)return false;
   st=await fetchAllPages<any>((start,end)=>supabase.rpc('transport_opening_invoice_query',{p_kind:'details',p_side:selectedSide,p_filters:filters,p_limit:end-start+1,p_offset:start}));
  }
 }
 if(request===generation.current){setPartyMasters([...customers.map(r=>({side:'customer' as const,party_id:r.id,party_name:r.name})),...suppliers.map(r=>({side:'supplier' as const,party_id:r.id,party_name:r.name}))]);setDocuments(d);setTripDetails([...ct.map(r=>({...r,side:selectedSide})),...st.map(r=>({...r,side:selectedSide}))]);setMovements(m);setCanonical(c);setAccounts(a);setCanLedger(ledgerAllowed);return true;}
 return false;
 }catch(e){if(request===generation.current){setError(e&&typeof e==='object'&&'message' in e?String(e.message):'Unable to load reports');setDocuments([]);setMovements([]);setCanonical([]);}return false;}
 finally{if(request===generation.current)setLoading(false)}
 },[company,unit,branch,side,party,to,tripSearch,mode,readFinancial]);
 useEffect(()=>{setLoading(true);const timer=window.setTimeout(()=>void load(),200);return()=>{window.clearTimeout(timer);generation.current++}},[load]);
 const parties=useMemo(()=>Array.from(new Map([...partyMasters,...documents,...canonical].filter(r=>r.side===side).map(r=>[r.party_id,r.party_name])).entries()).sort((a,b)=>a[1].localeCompare(b[1])),[partyMasters,documents,canonical,side]);
 const filter=(r:{side:PartySide;party_id:string;trip_no?:string;order_no?:string})=>r.side===side&&(!party||r.party_id===party)&&(!tripSearch||`${r.trip_no??''} ${r.order_no??''}`.toLowerCase().includes(tripSearch.toLowerCase()));
 const matchingDocs=documents.filter(filter);const matchingEvents=movements.filter(filter);
 const ledger=statement(mode==='canonical'?canonical.filter(r=>r.side===side&&r.party_id===party):matchingEvents,from,to);
 const balances=documentBalances(matchingDocs,matchingEvents,to).filter(d=>status==='all'||(status==='outstanding'?d.outstanding>0:status==='credit'?d.credit>0:d.outstanding===0&&d.credit===0));
 const selectedName=parties.find(p=>p[0]===party)?.[1]??'All parties';
 const dateError=!['outstanding','reconciliation'].includes(mode)&&!!(from&&to&&from>to);const needsParty=['statement','trip-statement','trip-ledger','canonical'].includes(mode)&&!party;
 const amount=(n:unknown)=>financialNumber(n);const rawReport=useMemo<ReportTable>(()=>{
 const title=`Transport ${side==='customer'?'Customer':'Supplier'} ${mode}`;
 const description=`${activeCompany?.company_name??''} / ${activeBusinessUnit?.business_unit_name??''} / active branch · ${selectedName} · ${mode==='outstanding'?`As of ${to?formatNaviloDate(to):'all dates'}`:`${from?formatNaviloDate(from):'Beginning'} to ${to?formatNaviloDate(to):'all dates'}`} · Company base currency · Supplier positive balance = payable; customer positive balance = receivable. Imported invoice dates are carry-forward dates; original issue dates were not supplied. Previously settled source amounts do not create new cash entries. ${tripSearch?`Trip/document filter: ${tripSearch}. `:''}`;
 if(mode==='outstanding'){
 const columns=['Party','Trip','Document','Date','Kind','Net after credits','VAT after credits','Gross after credits','Received / Paid','Refund / Recovery','Outstanding gross','Credit gross'];
 const rows=balances.map(d=>[d.party_name,d.trip_no,d.order_no,formatNaviloDate(d.order_date),d.kind,d.net,d.vat,d.billed,d.paid,d.refund,d.outstanding,d.credit]);
 const sums=["TOTAL","","","","",...['net','vat','billed','paid','refund','outstanding','credit'].map(k=>money(balances.reduce((s,d)=>s+cents(d[k as keyof typeof d]),0)))];
 return {title,description:description+` Status: ${status}. Includes older unsettled bills.`,columns,rows:[...rows,sums]};
 }
 if(['statement','trip-statement','trip-ledger','canonical'].includes(mode))return {title,description:description+(mode==='canonical'?' Complete canonical party ledger in active branch; includes other modules and unallocated money. Trip filter is not applied.':' Transport-attributed movements only; unallocated receipts/payments excluded. Allocations deleted by reversals before the reporting update require manual reconciliation.'),
 columns:['Date','Trip','Document','Event','Voucher','Description','Debit','Credit',side==='supplier'?'Running payable':'Running receivable'],
 rows:[['Opening','','','','','',0,0,ledger.opening],...ledger.rows.map(r=>[formatNaviloDate(r.event_date),r.trip_no??'',r.order_no??'',r.event_type??'canonical',r.entry_no,r.description??'',Number(r.debit),Number(r.credit),r.running]),['TOTAL / Closing','','','','','',ledger.debit,ledger.credit,ledger.closing]]};
 if(mode==='allocations'){
 const rows=matchingEvents.filter(r=>(!from||r.event_date>=from)&&(!to||r.event_date<=to)&&/receipt|payment|refund|recovery/.test(r.event_type??''));
 const voucherTotals=new Map<string,number>();for(const r of rows)voucherTotals.set(r.journal_entry_id,(voucherTotals.get(r.journal_entry_id)??0)+cents(r.amount));
 return {title,description:description+' Voucher totals are the Transport shares within the report filters; full voucher opens separately. Reversals carry the opposite sign.',
 columns:['Date','Party','Trip','Bill','Event','Voucher','Allocated gross (signed balance effect)','Transport voucher total (shown once)'],
 rows:rows.sort((a,b)=>a.event_date.localeCompare(b.event_date)||a.journal_entry_id.localeCompare(b.journal_entry_id)||a.event_id.localeCompare(b.event_id)).map((r,i,all)=>[formatNaviloDate(r.event_date),r.party_name,r.trip_no??'',r.order_no??'',r.event_type??'',r.entry_no,Number(r.amount),i===0||all[i-1].journal_entry_id!==r.journal_entry_id?money(voucherTotals.get(r.journal_entry_id)??0):''])};
 }
 const current=documentBalances(matchingDocs,matchingEvents,'');
 return {title,description:`${description} Live document reconciliation uses all posted dates, independent of report date range. Difference should be zero.`,
 columns:['Party','Trip','Document','Movement balance gross','Canonical outstanding less credit','Difference','Link count'],
 rows:current.map(d=>{const canonicalBalance=Number(d.current_outstanding_gross??0)-Number(d.current_credit_gross??0);return [d.party_name,d.trip_no,d.order_no,d.balance,canonicalBalance,money(cents(d.balance)-cents(canonicalBalance)),d.trip_ids.length]})};
 },[side,mode,activeCompany?.company_name,activeBusinessUnit?.business_unit_name,selectedName,to,from,tripSearch,status,balances,ledger,matchingEvents,matchingDocs]);
 const withoutVat=hasOnlyWithoutVatDocuments(matchingDocs);
 const report=billingReport(rawReport,withoutVat);
 const detailsByDocument=useMemo(()=>{const map=new Map<string,any[]>();for(const t of tripDetails){const key=t.side+':'+(t.order_id||t.order_no);const rows=map.get(key)||[];rows.push(t);map.set(key,rows)}return map},[tripDetails]);
 const documentLookup=new Map(matchingDocs.map(d=>[d.party_name+':'+d.order_no,d]));
 const documentColumn=report.columns.findIndex(c=>c==='Document'||c==='Bill');
 const detailedReportBase:ReportTable=documentColumn<0?report:{...report,columns:[...report.columns,'Trip dates','From','To','Vehicles at posting','Drivers at posting','Owners at posting','Jobs / PO / DO','Document base amount','Document charges','Document VAT','Document gross','Charge description'],rows:report.rows.map(row=>{const partyLabel=mode==='allocations'?row[1]:['outstanding','reconciliation'].includes(mode)?row[0]:selectedName;const doc=documentLookup.get(partyLabel+':'+row[documentColumn]);const details=detailsByDocument.get(side+':'+(doc?.order_id||row[documentColumn]))||detailsByDocument.get(side+':'+row[documentColumn])||[];return [...row,...['trip_date','from_location','to_location','vehicle_no','driver_name','owner_name','po_do_job_no'].map(key=>[...new Set(details.map(t=>t[key]?(key==='trip_date'?formatNaviloDate(t[key]):key==='vehicle_no'?vehicleDisplayLabel(t.vehicle_no,t.truck_type):t[key]):'Unattributed'))].join(' / ')),...['base_amount','charge_amount','tax_amount','total_amount','charge_breakdown'].map(key=>details.length?(key==='charge_breakdown'?details[0][key]||'':details[0][key]==null?'Not supplied':Number(details[0][key])):'')]})};
 const rawDetailedReport:ReportTable=['trip-statement','trip-ledger'].includes(mode)?{...detailedReportBase,columns:[detailedReportBase.columns[1],detailedReportBase.columns[0],...detailedReportBase.columns.slice(2)],rows:detailedReportBase.rows.map(r=>[r[1],r[0],...r.slice(2)])}:detailedReportBase;
 const detailedReport=billingReport(rawDetailedReport,withoutVat);
 const getRowLinks=(row:ReportTable['rows'][number])=>{
  const read=(key:string)=>{const index=detailedReport.columns.indexOf(key);return index<0?'':String(row[index]??'')};
  const documentNo=read('Document')||read('Bill');const tripNo=read('Trip');const voucherNo=read('Voucher');
  const partyName=read('Party')||selectedName;
  const doc=documentNo?matchingDocs.find(d=>d.order_no===documentNo&&(partyName==='All parties'||d.party_name===partyName)&&(!tripNo||d.trip_no===tripNo)):undefined;
  const journalEvent=voucherNo?(mode==='canonical'?canonical:matchingEvents).find(e=>e.entry_no===voucherNo&&(!documentNo||e.order_no===documentNo)&&(!tripNo||e.trip_no===tripNo)):undefined;
  const links:{label:string;href:string}[]=[];
  if(doc&&doc.kind!=='opening_balance')links.push({label:side==='customer'?'Open sales invoice':'Open purchase invoice',href:`/${side==='customer'?'sales':'purchase'}/${encodeURIComponent(doc.order_id)}`});
  const journalId=journalEvent?.journal_entry_id||doc?.journal_entry_id;
  if(journalId)links.push({label:'Open journal voucher',href:`/accounting/${encodeURIComponent(journalId)}`});
  return links;
 };
 const canExport=!loading&&!error&&!dateError&&!needsParty&&(mode==='trips'||readFinancial)&&!(mode==='canonical'&&!canLedger);
 async function exportAs(format:'xlsx'|'pdf'|'print'){if(!(format==='print'?outputAllowed.print:outputAllowed.export))return;try{await exportPartyReport(detailedReport,format)}catch(e){setError(e instanceof Error?e.message:'Export failed')}}
 return <section className="rounded-lg border bg-white p-3 text-xs" aria-label="Transport party reports">
 <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">{allocationEntry?"Bulk Allocation":`${side==='supplier'?'Supplier':'Customer'} Reports`}</h2><div className="flex gap-2"><button className="btn" disabled={busy||loading} onClick={()=>void load()}>Refresh reports</button><button className="btn" disabled={busy} onClick={onClose}>Close reports</button></div></div>
 <p className="my-2">Scope: current Company / Business Unit / active branch. Amounts are in company base currency. Outstanding uses the As of date; From applies to statements and allocation movements. allocations deleted by reversals before this update cannot be reconstructed automatically.</p>
 <TransportVatGuide/>
 <fieldset disabled={busy} className="flex flex-wrap items-end gap-2"><label>Party side<NaviloSearchableSelect nativeCompatibility preserveLabel aria-label="Party side" className="input" value={side} onChange={e=>{setSide(e.target.value as PartySide);setParty('');setLoadAllParties(false);setSettlement(false)}}><option value="customer" disabled={!readSides.customer}>Customer</option><option value="supplier" disabled={!readSides.supplier}>Supplier / Owner</option></NaviloSearchableSelect></label>
 <label>Party<NaviloSearchableSelect nativeCompatibility preserveLabel aria-label="Party" className="input" value={party} onChange={e=>{setParty(e.target.value);setLoadAllParties(false);setSettlement(false)}}><option value="">Select party / all parties</option>{parties.map(([id,name])=><option key={id} value={id}>{name}</option>)}</NaviloSearchableSelect></label>
 <label>Report<NaviloSearchableSelect nativeCompatibility preserveLabel aria-label="Report" className="input" value={mode} onChange={e=>setMode(e.target.value as Mode)}><option value="trips">Trip-wise statement / all trips</option><option value="outstanding">Invoice-wise outstanding</option><option value="trip-statement">Trip-wise posted statement</option><option value="trip-ledger">Trip-wise posted ledger</option><option value="statement">Invoice-wise posted statement / ledger</option><option value="allocations">Receipt / payment allocations</option><option value="canonical" disabled={!canLedger}>Complete canonical party ledger</option><option value="reconciliation">Document reconciliation</option></NaviloSearchableSelect></label>
 <label>From<NaviloDateInput className="input" type="date" value={from} disabled={mode==='outstanding'||mode==='reconciliation'} onChange={e=>setFrom(e.target.value)}/></label><label>As of / To<NaviloDateInput className="input" type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
 <label>Trip / document search<input className="input" disabled={mode==='canonical'} value={tripSearch} onChange={e=>setTripSearch(e.target.value)}/></label>
 {mode==='outstanding'&&<label>Balance<NaviloSearchableSelect nativeCompatibility preserveLabel className="input" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All documents</option><option value="outstanding">Outstanding only</option><option value="settled">Settled only</option><option value="credit">Credits / refunds only</option></NaviloSearchableSelect></label>}
 <button className="btn" data-navilo-keep-local-action="true" onClick={()=>setShowAdvances(v=>!v)}>Advances / Unallocated Money</button><button className="btn-primary" disabled={!party||loading||!!error} onClick={()=>setSettlement(v=>!v)}>{side==='customer'?'Receive across Trips':'Pay supplier across Trips'}</button></fieldset>
 {!party&&!partyRequired&&mode!=='trips'&&!loadAllParties&&<div className="my-3 flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-slate-50 p-3"><p className="text-slate-700">Select a customer or supplier for a fast report. Automatic loading of every party is disabled to avoid database statement timeouts.</p><button type="button" className="btn" disabled={loading||busy} onClick={()=>setLoadAllParties(true)}>Load all parties (large report)</button></div>}
 {loadAllParties&&!party&&mode!=='trips'&&<p className="my-2 text-amber-700">All-party reports may take longer. Select one party if the database times out.</p>}
 {error&&<p role="alert" className="my-2 text-red-700">{error}</p>}{dateError&&<p role="alert" className="text-red-700">From must be on or before To.</p>}{needsParty&&<p className="my-2">Select one party for opening and running balances.</p>}
 {loading?<p role="status">Loading all report pages…</p>:canExport&&<>{mode==='trips'?<TransportTripReports side={side} party={party} externalFilters={{from,to,search:tripSearch}}/>:<ConfigurableReport report={detailedReport} preferenceKey={`${company}:${unit}:${side}:${mode}`} getRowLinks={getRowLinks}/>}
 <details className="mt-2"><summary>Open source documents and vouchers</summary><div className="max-h-48 overflow-auto">{matchingDocs.map(d=><p key={d.order_id}>{d.trip_no} · {d.kind==='opening_balance'?<span>{d.order_no} · imported opening balance</span>:<a className="underline text-blue-700" href={`/${side==='customer'?'sales':'purchase'}/${d.order_id}`}>{d.order_no}</a>} · <a className="underline text-blue-700" href={`/accounting/${d.journal_entry_id}`}>{d.kind==='opening_balance'?'Opening balance journal':'Original journal'}</a></p>)}{ledger.rows.map(r=><p key={r.event_id}><a className="underline text-blue-700" href={`/accounting/${r.journal_entry_id}`}>{r.entry_no}</a> · {r.trip_no} · {r.event_type}</p>)}</div></details>
 {mode==='reconciliation'&&party&&canLedger&&<p className="mt-2">Party balance as of {to||'all dates'}: Transport {amount(statement(movements.filter(r=>r.side===side&&r.party_id===party),'',to).closing)} · Complete canonical ledger {amount(statement(canonical.filter(r=>r.side===side&&r.party_id===party),'',to).closing)}. The difference includes other business documents, opening balances and unallocated money; it is not automatically a Transport error.</p>}
 </>}
 {showAdvances&&<TransportAdvanceOperations onChanged={async()=>{await load();await onChanged()}}/>}
 {settlement&&party&&<TransportPartySettlement key={`${company}:${unit}:${branch}:${side}:${party}`} side={side} party={party} documents={documents} accounts={accounts} onBusyChange={setBusy} onPosted={async()=>{if(!await load())throw new Error('Report refresh failed');await onChanged()}}/>}
 </section>;
}
