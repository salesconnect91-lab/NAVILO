import {useEffect,useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import NaviloDateInput from '@/components/NaviloDateInput';
import ConfigurableReport from '../transport/ConfigurableReport';
import {fetchAllPages,fetchByIdChunks} from '@/lib/fetchAllPages';
import {accountingLocalDate} from '@/lib/accountingLocalDate';
import {formatNaviloDate} from '@/lib/naviloDate';
import {buildDailyClosing,type ClosingAccount,type ClosingEntry,type ClosingLine,type ClosingBalance,type ClosingSummary} from './dailyCashClosingMath';

type ClosingData={key:string;branchId:string;projection:ReturnType<typeof buildDailyClosing>};
const money=(n:number)=>n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export default function DailyCashClosing(){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const company=activeCompany?.company_id??'',businessUnit=activeBusinessUnit?.business_unit_id??'';
 const [date,setDate]=useState(()=>accountingLocalDate()),[reload,setReload]=useState(0);
 const [state,setState]=useState<ClosingData|null>(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState('');
 const key=[company,businessUnit,date,reload].join('|');
 const data=state?.key===key?state:null;
 useEffect(()=>{
  let live=true;setState(null);setLoading(true);setError('');
  if(!company||!businessUnit||!date){setError('Active company, business unit and closing date required.');setLoading(false);return()=>{live=false}}
  (async()=>{
   try{
    const {data:branchId,error:locError}=await supabase.rpc('current_operating_location_id');
    if(locError)throw locError;
    if(!branchId||typeof branchId!=='string')throw new Error('Select active operating branch.');
    const [cashFlow,balanceEvidence,entries,accounts]=await Promise.all([
     supabase.rpc('accounting_cash_flow_report_scoped',{p_from:date,p_to:date,p_scope:'branch'}),
     supabase.rpc('accounting_report_balances_scoped',{p_from:date,p_to:date,p_exclude_closing:false,p_scope:'branch'}),
     fetchAllPages<ClosingEntry>((from,to)=>supabase.from('journal_entries')
       .select('id,entry_no,entry_date,description,party_name,trans_type,created_at')
       .eq('company_id',company).eq('business_unit_id',businessUnit)
       .eq('operating_location_id',branchId).eq('status','posted').eq('entry_date',date)
       .order('created_at').order('id').range(from,to)),
     fetchAllPages<ClosingAccount>((from,to)=>supabase.from('chart_of_accounts')
       .select('id,code,name,type,detail_type,account_role').eq('company_id',company)
       .eq('is_group',false).order('id').range(from,to))
    ]);
    if(cashFlow.error)throw cashFlow.error;
    if(balanceEvidence.error)throw balanceEvidence.error;
    if(!cashFlow.data||!Array.isArray(balanceEvidence.data)||!Array.isArray(entries)||!Array.isArray(accounts))
      throw new Error('Incomplete posted closing evidence; no final totals can be printed.');
    const ids=entries.map(e=>e.id);
    const lines=ids.length?await fetchByIdChunks<ClosingLine>(ids,(chunk,from,to)=>
      supabase.from('journal_lines')
       .select('id,entry_id,account_id,account,debit,credit,coa:chart_of_accounts(id,name,type,detail_type)')
       .eq('company_id',company).eq('business_unit_id',businessUnit)
       .eq('operating_location_id',branchId).in('entry_id',chunk).order('id').range(from,to) as any):[];
    if(!Array.isArray(lines))throw new Error('Incomplete posted voucher lines; daily closing withheld.');
    const projection=buildDailyClosing(date,accounts,balanceEvidence.data as ClosingBalance[],
      entries,lines,cashFlow.data as ClosingSummary);
    if(live)setState({key,branchId,projection});
   }catch(e){if(live){setState(null);setError(e instanceof Error?e.message:String(e))}}
   finally{if(live)setLoading(false)}
  })();
  return()=>{live=false};
 },[company,businessUnit,date,reload,key]);

 const p=data?.projection;
 const report=useMemo(()=>p?{
  title:'Daily Cash & Bank Closing',
  description:[activeCompany?.company_name||'Company',activeBusinessUnit?.business_unit_name||'',
    formatNaviloDate(date),'Posted branch transactions only',
    'Opening SAR '+money(p.opening),'Closing SAR '+money(p.closing),
    'All cash and bank movements including internal transfers',
    'Cash/Bank account reconciliation PASS'].filter(Boolean).join(' · '),
  columns:['Cash / Bank','Description / Voucher','Receipts (SAR)','Payments (SAR)','Running Balance','Account Balance'],
  rows:p.reportRows,
 }:null,[p,activeCompany?.company_name,activeBusinessUnit?.business_unit_name,date]);
 return <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
  <header className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-3">
   <div><h1 className="text-lg font-bold text-slate-900">Daily Cash &amp; Bank Closing</h1>
    <p className="text-xs text-slate-600">TWAKKAL-style daily sheet + complete posted voucher / bank / petty cash register</p></div>
   <div className="no-print flex flex-wrap items-end gap-2" data-no-export>
    <label className="text-xs font-semibold text-slate-700">Closing date
     <NaviloDateInput className="input mt-1 block" value={date} onChange={e=>setDate(e.target.value)}/></label>
    <button className="btn-secondary" type="button" disabled={loading} onClick={()=>setReload(x=>x+1)}>Refresh</button>
    <Link className="btn-secondary" to="/accounting/cash-counter">Cash Counter</Link>
    <Link className="btn-secondary" to="/accounting/bank-reconciliation">Bank Reconciliation</Link>
   </div>
  </header>
  {error&&<div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
   Daily closing is not reconciled: {error}. No report will be shown until posted evidence is complete.</div>}
  {loading&&<p role="status" className="p-5 text-sm text-slate-600">Reconciling posted vouchers, bank transfers and account balances…</p>}
  {!loading&&!error&&p&&report&&<>
   <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
    {([['Opening balance',p.opening],['Today receipts',p.externalReceipts],
      ['Today payments',p.externalPayments],['Closing balance',p.closing]] as const).map(([label,value])=>
      <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
       <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
       <div className="mt-1 text-lg font-bold tabular-nums text-[#173c49]">SAR {money(value)}</div>
      </div>)}
   </div>
   <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
    <div className="rounded border p-2"><strong>{p.voucherCount}</strong> posted vouchers with cash/bank movements</div>
    <div className="rounded border p-2"><strong>SAR {money(p.transferAmount)}</strong> internal transfers (not expenses)</div>
    <div className="rounded border p-2"><strong>SAR {money(p.grossReceipts)}</strong> gross account receipts</div>
    <div className="rounded border p-2"><strong>SAR {money(p.grossPayments)}</strong> gross account payments</div>
   </div>
   <section aria-label="Bank and petty cash closing balances" className="rounded-lg border border-slate-200">
    <h2 className="border-b bg-[#eef6f4] px-3 py-2 text-sm font-bold text-[#173c49]">SNB / Riyadh / All Banks / Cash in Hand / Petty Cash — Closing by Ledger</h2>
    <div className="overflow-x-auto"><table className="min-w-full text-xs">
     <thead className="bg-slate-100 text-left text-slate-700"><tr><th className="p-2">Account / Bank</th><th className="p-2">Type</th>
      <th className="p-2 text-right">Opening</th><th className="p-2 text-right">In</th>
      <th className="p-2 text-right">Out</th><th className="p-2 text-right">Closing</th></tr></thead>
     <tbody>{p.accounts.map(a=><tr key={a.id} className="border-t">
      <td className="p-2 font-medium">{a.name}</td><td className="p-2">{a.kind}</td>
      <td className="p-2 text-right tabular-nums">{money(a.opening)}</td>
      <td className="p-2 text-right tabular-nums">{money(a.received)}</td>
      <td className="p-2 text-right tabular-nums">{money(a.paid)}</td>
      <td className="p-2 text-right font-semibold tabular-nums">{money(a.closing)}</td></tr>)}</tbody>
     <tfoot><tr className="border-t-2 bg-slate-50 font-bold"><td className="p-2" colSpan={2}>ALL CASH / BANK ACCOUNTS</td>
      <td className="p-2 text-right">{money(p.opening)}</td><td className="p-2 text-right">{money(p.grossReceipts)}</td>
      <td className="p-2 text-right">{money(p.grossPayments)}</td><td className="p-2 text-right">{money(p.closing)}</td></tr></tfoot>
    </table></div>
   </section>
   <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs font-semibold text-emerald-900">
    Posted reconciliation PASS: Opening + Net External Receipts − Net External Payments = Closing. Bank-to-bank transfers remain visible, without being counted as company expenses.
   </div>
   <section aria-label="Complete daily closing sheet">
    <h2 className="mb-1 text-sm font-bold text-slate-800">Complete Daily Closing Sheet — All transactions, running balances and account summary</h2>
    <p className="text-xs text-slate-500">The full detail and closing account breakdown below are included in the same Print / PDF / Excel report; exports are not restricted to the visible 100-row page.</p>
    <ConfigurableReport module="accounting" preferenceKey={company+':'+businessUnit+':'+data.branchId+':daily-cash-bank'}
     report={report}/>
   </section>
  </>}
  <p className="text-xs text-slate-500">Posted journal/ledger evidence only. Supplier bills are not counted as cash payments until actually settled. The report never creates journals. Cash/Bank-to-Cash/Bank transfers show both legs but are not P&amp;L expenses.</p>
 </section>;
}
