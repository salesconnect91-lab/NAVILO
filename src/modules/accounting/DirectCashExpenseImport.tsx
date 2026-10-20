import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import * as XLSX from 'xlsx';
import {supabase} from '@/lib/supabase';
import {useAuth} from '@/auth/AuthContext';
import {fetchAllPages} from '@/lib/fetchAllPages';
import {downloadImportTemplate} from '@/lib/importExcelTemplate';
import {parseDirectCashExpenseRows,type DirectCashAccount,type DirectCashExpenseRow} from './directCashExpenseImport';

/** Supplier-less Office/Yard/General expenses; no VAT or Accounts Payable.
 * Uses one atomic database request, never sequential browser posting. */
export default function DirectCashExpenseImport(){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const company=activeCompany?.company_id??'',bu=activeBusinessUnit?.business_unit_id??'',scope=company+':'+bu;
 const current=useRef(scope);current.current=scope;
 const picker=useRef<HTMLInputElement>(null),lock=useRef(false);
 const [accounts,setAccounts]=useState<DirectCashAccount[]>([]);
 const [rows,setRows]=useState<DirectCashExpenseRow[]>([]),[selectedScope,setSelectedScope]=useState('');
 const [filename,setFilename]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[message,setMessage]=useState('');
 const [importReady,setImportReady]=useState(false),[checkingReady,setCheckingReady]=useState(true);
 useEffect(()=>{
  let live=true;setCheckingReady(true);setImportReady(false);
  if(!company||!bu){setCheckingReady(false);return()=>{live=false}};
  void supabase.rpc('accounting_direct_cash_expense_import_ready').then(result=>{
   if(live)setImportReady(!result.error&&result.data===true);
  }).catch(()=>{if(live)setImportReady(false)}).finally(()=>{if(live)setCheckingReady(false)});
  return()=>{live=false};
 },[scope,company,bu]);
 useEffect(()=>{
  let live=true;
  setRows([]);setFilename('');setSelectedScope('');setError('');setMessage('');setAccounts([]);setLoading(true);
  if(!company||!bu){setLoading(false);return()=>{live=false}};
  void fetchAllPages<DirectCashAccount>((from,to)=>supabase.from('chart_of_accounts')
    .select('id,name,code,type,detail_type,account_role,is_group,is_active,allow_manual_entries')
    .eq('company_id',company).eq('is_active',true).eq('is_group',false).eq('allow_manual_entries',true)
    .order('id').range(from,to),500)
   .then(r=>{if(live)setAccounts(r)}).catch(e=>{if(live)setError(e instanceof Error?e.message:'Unable to load scoped accounting masters.')})
   .finally(()=>{if(live)setLoading(false)});
  return()=>{live=false};
 },[scope,company,bu]);
 const download=()=>downloadImportTemplate({
  filename:'NAVILO-Direct-Cash-Expenses-Import.xlsx',sheetName:'Direct Cash Expense',title:'Office / Yard / General · Direct Cash Expense',
  headers:['Date','Area','Expense Account','Cash / Bank Account','Paid To','Description','Amount SAR','Source Reference'],
  example:['2026-10-19','Office','General Expenses','Cash','Puncture Shop','Office consumables',30,'CASH-EXP-001'],
  notes:[
   'No Supplier Master or supplier invoice is created. Select actual Expense GL and Cash/Bank account from Chart of Accounts.',
   'Area: Office, Yard, General only. Vehicle expenses use Vehicle Expense Excel to preserve vehicle P&L.',
   'No recoverable VAT on a direct cash expense. For VAT tax invoices use purchase/expense invoice workflow.',
   'Each Source Reference must be unique across previous uploads in the company and Business Unit. Maximum 100 rows.',
   'Posting must be explicitly confirmed; all rows post or the entire database transaction rolls back.',
   'Office and Yard need distinct Expense GL accounts for separate P&L: Area alone does not create a cost centre.'
  ]});
 async function choose(e:React.ChangeEvent<HTMLInputElement>){
  const file=e.target.files?.[0];e.target.value='';if(!file||lock.current)return;
  lock.current=true;setBusy(true);setRows([]);setSelectedScope('');setError('');setMessage('');setFilename('');
  try{
   if(loading||!accounts.length)throw Error('Wait for Chart of Accounts to load.');
   if(file.size>5*1024*1024)throw Error('Maximum file size is 5 MB.');
   const workbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false});
   if(!workbook.SheetNames.length)throw Error('Expense workbook has no sheet.');
   const input=XLSX.utils.sheet_to_json<Record<string,unknown>>(workbook.Sheets[workbook.SheetNames[0]],{defval:'',raw:false});
   const reviewed=parseDirectCashExpenseRows(input,accounts);
   if(current.current!==scope)return;
   setRows(reviewed);setSelectedScope(scope);setFilename(file.name);
  }catch(e){setError(e instanceof Error?e.message:'Unable to validate expense workbook.')}
  finally{lock.current=false;setBusy(false)}
 }
 async function post(){
  if(lock.current||!importReady||!rows.length||selectedScope!==scope||!company||!bu)return;
  if(!window.confirm('Post '+rows.length+' Office/Yard/General CASH expenses? This creates real, immutable vouchers, reduces Cash/Bank and has no supplier payable. Verify GL accounts and references first.'))return;
  lock.current=true;setBusy(true);setError('');setMessage('');
  try{
   const result=await supabase.rpc('accounting_import_direct_cash_expenses',{p_rows:rows} as any);
   if(result.error)throw result.error;
   if(result.data?.success!==true||Number(result.data.posted_count)!==rows.length)
    throw Error('Server did not confirm all expense journals. Inspect Posted Vouchers before retrying.');
   if(current.current!==scope)return;
   setMessage(rows.length+' direct cash expense vouchers posted atomically. No supplier account or duplicate manual journal created.');
   setRows([]);setSelectedScope('');setFilename('');
  }catch(e){
   const msg=e instanceof Error?e.message:typeof e==='object'&&e&&'message' in e?String(e.message):'Unknown error';
   setError(/accounting_import_direct_cash_expenses|could not find the function|schema cache/i.test(msg)
    ?'Database import migration is not approved/applied yet. Excel preview works; no vouchers were posted.'
    :'Atomic batch failed or response uncertain: '+msg+'. Verify posted vouchers before retrying; do not assume partial success.');
  }finally{lock.current=false;setBusy(false)}
 }
 const amount=rows.reduce((sum,row)=>sum+Math.round(row.amount*100),0)/100;
 return <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3" aria-label="Direct Cash Expense Excel Import">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div><h2 className="text-sm font-bold text-slate-900">Office / Yard / General — Direct Cash Expense Excel</h2>
    <p className="text-xs text-slate-600">No supplier account • no VAT claim • atomic posting • cash/bank closing</p></div>
   <div className="flex flex-wrap gap-2"><button className="btn-secondary" type="button" onClick={download}>Download Cash Expense Template</button>
    <button className="btn-secondary" type="button" disabled={loading||busy||!company||!bu} onClick={()=>picker.current?.click()}>Choose Excel / Preview</button></div>
  </div>
  <input ref={picker} type="file" accept=".xlsx,.xls,.csv" className="hidden" aria-label="Upload direct cash expense Excel" onChange={e=>void choose(e)}/>
  <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
   <strong>{checkingReady?'Checking atomic posting setup…':importReady?'Atomic posting backend available.':'Database migration not yet approved/applied: Preview Only.'}</strong> {importReady?'All records will post in one transaction with duplicate-source protection.':'You can download and validate Excel now. Posting is safely disabled until database rollout.'}
   Vehicle expenses must use <Link className="underline font-semibold" to="/settings/imports?section=vehicle-expenses">Vehicle Expense Excel</Link>.
   Individual payment: <Link className="underline font-semibold" to="/accounting/cash-counter?mode=general">General Cash Expense Payment</Link>.
  </p>
  {loading&&<p role="status" className="text-xs text-slate-500">Loading scoped Expense GL and Cash/Bank Masters…</p>}
  {error&&<p role="alert" className="rounded bg-red-50 p-2 text-xs text-red-800">{error}</p>}
  {message&&<p role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-800">{message}</p>}
  {rows.length>0&&selectedScope===scope&&<div className="space-y-2">
   <p className="text-xs font-semibold">{filename}: {rows.length} validated expenses · Total SAR {amount.toLocaleString('en-US',{minimumFractionDigits:2})}</p>
   <div className="max-h-96 overflow-auto rounded border"><table className="min-w-full whitespace-nowrap text-left text-xs">
    <thead className="sticky top-0 bg-slate-100"><tr>{['Date','Area','Expense GL','Cash/Bank','Paid To','Description','SAR','Reference'].map(x=><th className="p-2" key={x}>{x}</th>)}</tr></thead>
    <tbody>{rows.map(r=><tr key={r.source_reference} className="border-t">
     <td className="p-2">{r.transaction_date}</td><td className="p-2">{r.expense_area}</td>
     <td className="p-2">{accounts.find(a=>a.id===r.expense_account_id)?.name}</td>
     <td className="p-2">{accounts.find(a=>a.id===r.cash_bank_account_id)?.name}</td>
     <td className="p-2">{r.paid_to||'—'}</td><td className="p-2">{r.description}</td>
     <td className="p-2 text-right">{r.amount.toFixed(2)}</td><td className="p-2">{r.source_reference}</td>
    </tr>)}</tbody></table></div>
   <button type="button" className="btn-primary" disabled={busy||!importReady} onClick={()=>void post()}>{busy?'Checking / Posting…':'Confirm & Post '+rows.length+' Cash Expenses'}</button>
  </div>}
  <p className="text-xs text-slate-500">Only Office/Yard/General direct payments. Distinct Expense GL accounts for separate P&amp;L; VAT requires valid source tax invoice. Do not re-import posted expenses.</p>
 </section>;
}
