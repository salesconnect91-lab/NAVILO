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
type Mode='outstanding'|'statement'|'allocations'|'canonical'|'reconciliation';
export default function TransportPartyReports({onClose,onChanged}:{onClose:()=>void;onChanged:()=>Promise<void>}){
 const outputAllowed=useTransportOutputPermissions();
 const {activeCompany,activeBusinessUnit}=useAuth();const company=activeCompany?.company_id;const unit=activeBusinessUnit?.business_unit_id;
 const [side,setSide]=useState<PartySide>('customer');const [party,setParty]=useState('');const [mode,setMode]=useState<Mode>('outstanding');
 const [documents,setDocuments]=useState<PartyDocument[]>([]);const [movements,setMovements]=useState<PartyMovement[]>([]);
 const [canonical,setCanonical]=useState<PartyMovement[]>([]);const [accounts,setAccounts]=useState<Array<{id:string;name:string;detail_type:string}>>([]);
 const [canLedger,setCanLedger]=useState(false);const [from,setFrom]=useState('');const [to,setTo]=useState(new Date().toISOString().slice(0,10));
 const [tripSearch,setTripSearch]=useState('');const [status,setStatus]=useState('all');const [settlement,setSettlement]=useState(false);const [showAdvances,setShowAdvances]=useState(false);
 const [busy,setBusy]=useState(false);const [loading,setLoading]=useState(false);const [error,setError]=useState('');const generation=useRef(0);
 const load=useCallback(async()=>{
 if(!company||!unit)return false;const request=++generation.current;setLoading(true);setError('');
 try{
 const permission=await supabase.rpc('has_module_permission',{p_company_id:company,p_module:'accounting',p_action:'view'});
 if(permission.error)throw permission.error;const ledgerAllowed=permission.data===true;
 const [d,m,c,a]=await Promise.all([
 fetchAllPages<PartyDocument>((start,end)=>supabase.from('transport_party_documents').select('*').order('side').order('order_id').range(start,end)),
 fetchAllPages<PartyMovement>((start,end)=>supabase.from('transport_party_movements').select('*').order('event_id').range(start,end)),
 ledgerAllowed?fetchAllPages<PartyMovement>((start,end)=>supabase.from('transport_canonical_party_movements').select('*').order('event_id').range(start,end)):Promise.resolve([]),
 fetchAllPages<{id:string;name:string;detail_type:string}>((start,end)=>supabase.from('chart_of_accounts').select('id,name,detail_type').eq('company_id',company).eq('is_active',true).eq('is_group',false).in('detail_type',['Cash on Hand','Bank Account']).order('id').range(start,end))
 ]);
 if(request===generation.current){setDocuments(d);setMovements(m);setCanonical(c);setAccounts(a);setCanLedger(ledgerAllowed);return true;}
 return false;
 }catch(e){if(request===generation.current){setError(e instanceof Error?e.message:'Unable to load reports');setDocuments([]);setMovements([]);setCanonical([]);}return false;}
 finally{if(request===generation.current)setLoading(false)}
 },[company,unit]);
 useEffect(()=>{void load();return()=>{generation.current++}},[load]);
 const parties=useMemo(()=>Array.from(new Map([...documents,...canonical].filter(r=>r.side===side).map(r=>[r.party_id,r.party_name])).entries()).sort((a,b)=>a[1].localeCompare(b[1])),[documents,canonical,side]);
 const filter=(r:{side:PartySide;party_id:string;trip_no?:string;order_no?:string})=>r.side===side&&(!party||r.party_id===party)&&(!tripSearch||`${r.trip_no??''} ${r.order_no??''}`.toLowerCase().includes(tripSearch.toLowerCase()));
 const matchingDocs=documents.filter(filter);const matchingEvents=movements.filter(filter);
 const ledger=statement(mode==='canonical'?canonical.filter(r=>r.side===side&&r.party_id===party):matchingEvents,from,to);
 const balances=documentBalances(matchingDocs,matchingEvents,to).filter(d=>status==='all'||(status==='outstanding'?d.outstanding>0:status==='credit'?d.credit>0:d.outstanding===0&&d.credit===0));
 const selectedName=parties.find(p=>p[0]===party)?.[1]??'All parties';
 const dateError=!['outstanding','reconciliation'].includes(mode)&&!!(from&&to&&from>to);const needsParty=['statement','canonical'].includes(mode)&&!party;
 const amount=(n:unknown)=>financialNumber(n);const report=useMemo<ReportTable>(()=>{
 const title=`Transport ${side==='customer'?'Customer':'Supplier'} ${mode}`;
 const description=`${activeCompany?.company_name??''} / ${activeBusinessUnit?.business_unit_name??''} / active branch · ${selectedName} · ${mode==='outstanding'?`As of ${to?formatNaviloDate(to):'all dates'}`:`${from?formatNaviloDate(from):'Beginning'} to ${to?formatNaviloDate(to):'all dates'}`} · Company base currency · Supplier positive balance = payable; customer positive balance = receivable. ${tripSearch?`Trip/document filter: ${tripSearch}. `:''}`;
 if(mode==='outstanding'){
 const columns=['Party','Trip','Document','Date','Kind','Net after credits','VAT after credits','Gross after credits','Received / Paid','Refund / Recovery','Outstanding gross','Credit gross'];
 const rows=balances.map(d=>[d.party_name,d.trip_no,d.order_no,formatNaviloDate(d.order_date),d.kind,d.net,d.vat,d.billed,d.paid,d.refund,d.outstanding,d.credit]);
 const sums=["TOTAL","","","","",...['net','vat','billed','paid','refund','outstanding','credit'].map(k=>money(balances.reduce((s,d)=>s+cents(d[k as keyof typeof d]),0)))];
 return {title,description:description+` Status: ${status}. Includes older unsettled bills.`,columns,rows:[...rows,sums]};
 }
 if(mode==='statement'||mode==='canonical')return {title,description:description+(mode==='canonical'?' Complete canonical party ledger in active branch; includes other modules and unallocated money. Trip filter is not applied.':' Transport-attributed movements only; unallocated receipts/payments excluded. Allocations deleted by reversals before the reporting update require manual historical reconciliation.'),
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
 const canExport=!loading&&!error&&!dateError&&!needsParty&&!(mode==='canonical'&&!canLedger);
 async function exportAs(format:'xlsx'|'pdf'|'print'){if(!(format==='print'?outputAllowed.print:outputAllowed.export))return;try{await exportPartyReport(report,format)}catch(e){setError(e instanceof Error?e.message:'Export failed')}}
 return <section className="rounded-lg border bg-white p-3 text-xs" aria-label="Transport party reports">
 <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Customer / Supplier Reports and Allocation</h2><div className="flex gap-2"><button className="btn" disabled={busy||loading} onClick={()=>void load()}>Refresh reports</button><button className="btn" disabled={busy} onClick={onClose}>Close reports</button></div></div>
 <p className="my-2">Scope: current Company / Business Unit / active branch. Amounts are in company base currency. Outstanding uses the As of date; From applies to statements and allocation movements. Historical allocations deleted by reversals before this update cannot be reconstructed automatically.</p>
 <fieldset disabled={busy} className="flex flex-wrap items-end gap-2"><label>Party side<select aria-label="Party side" className="input" value={side} onChange={e=>{setSide(e.target.value as PartySide);setParty('');setSettlement(false)}}><option value="customer">Customer</option><option value="supplier">Supplier / Owner</option></select></label>
 <label>Party<select aria-label="Party" className="input" value={party} onChange={e=>{setParty(e.target.value);setSettlement(false)}}><option value="">All parties</option>{parties.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
 <label>Report<select aria-label="Report" className="input" value={mode} onChange={e=>setMode(e.target.value as Mode)}><option value="outstanding">Trip-wise outstanding</option><option value="statement">Transport statement / ledger</option><option value="allocations">Receipt / payment allocations</option><option value="canonical" disabled={!canLedger}>Complete canonical party ledger</option><option value="reconciliation">Document reconciliation</option></select></label>
 <label>From<NaviloDateInput className="input" type="date" value={from} disabled={mode==='outstanding'||mode==='reconciliation'} onChange={e=>setFrom(e.target.value)}/></label><label>As of / To<NaviloDateInput className="input" type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
 <label>Trip / document search<input className="input" disabled={mode==='canonical'} value={tripSearch} onChange={e=>setTripSearch(e.target.value)}/></label>
 {mode==='outstanding'&&<label>Balance<select className="input" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All documents</option><option value="outstanding">Outstanding only</option><option value="settled">Settled only</option><option value="credit">Credits / refunds only</option></select></label>}
 <button className="btn" data-navilo-keep-local-action="true" onClick={()=>setShowAdvances(v=>!v)}>Advances / Unallocated Money</button><button className="btn-primary" disabled={!party||loading||!!error} onClick={()=>setSettlement(v=>!v)}>{side==='customer'?'Receive across Trips':'Pay supplier across Trips'}</button></fieldset>
 {error&&<p role="alert" className="my-2 text-red-700">{error}</p>}{dateError&&<p role="alert" className="text-red-700">From must be on or before To.</p>}{needsParty&&<p className="my-2">Select one party for opening and running balances.</p>}
 {loading?<p role="status">Loading all report pages…</p>:canExport&&<><div className="my-3 flex gap-2"><button className="btn" data-navilo-keep-local-action="true" disabled={!outputAllowed.print} onClick={()=>void exportAs('print')}>Print</button><button className="btn" data-navilo-keep-local-action="true" disabled={!outputAllowed.export} onClick={()=>void exportAs('pdf')}>PDF</button><button className="btn" data-navilo-keep-local-action="true" disabled={!outputAllowed.export} onClick={()=>void exportAs('xlsx')}>Excel</button></div><p className="mb-2">{report.description}</p>
 <div className="max-h-[55vh] overflow-auto"><table className="w-full whitespace-nowrap text-left"><thead className="sticky top-0 bg-slate-100"><tr>{report.columns.map(c=><th key={c} className="p-2">{c}</th>)}</tr></thead><tbody data-business-data>{report.rows.map((row,i)=><tr key={i} className="border-t">{row.map((v,k)=><td key={k} className="p-2">{typeof v==='number'?(report.columns[k]==='Link count'?v:amount(v)):v}</td>)}</tr>)}</tbody></table></div>
 <details className="mt-2"><summary>Open source documents and vouchers</summary><div className="max-h-48 overflow-auto">{matchingDocs.map(d=><p key={d.order_id}>{d.trip_no} · <a className="underline text-blue-700" href={`/${side==='customer'?'sales':'purchase'}/${d.order_id}`}>{d.order_no}</a> · <a className="underline text-blue-700" href={`/accounting/${d.journal_entry_id}`}>Original journal</a></p>)}{ledger.rows.map(r=><p key={r.event_id}><a className="underline text-blue-700" href={`/accounting/${r.journal_entry_id}`}>{r.entry_no}</a> · {r.trip_no} · {r.event_type}</p>)}</div></details>
 {mode==='reconciliation'&&party&&canLedger&&<p className="mt-2">Party balance as of {to||'all dates'}: Transport {amount(statement(movements.filter(r=>r.side===side&&r.party_id===party),'',to).closing)} · Complete canonical ledger {amount(statement(canonical.filter(r=>r.side===side&&r.party_id===party),'',to).closing)}. The difference includes other business documents, opening balances and unallocated money; it is not automatically a Transport error.</p>}
 </>}
 {showAdvances&&<TransportAdvanceOperations onChanged={async()=>{await load();await onChanged()}}/>}
 {settlement&&party&&<TransportPartySettlement key={`${side}:${party}`} side={side} party={party} documents={documents} accounts={accounts} onBusyChange={setBusy} onPosted={async()=>{if(!await load())throw new Error('Report refresh failed');await onChanged()}}/>}
 </section>;
}
