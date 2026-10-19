import {useEffect,useRef,useState} from 'react';
import * as XLSX from 'xlsx';
import {Link} from 'react-router-dom';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import {downloadImportTemplate} from '@/lib/importExcelTemplate';
import NaviloSearchableSelect from '@/components/SearchableSelect';
import {parseNormalInvoiceImport,type NormalSide,type NormalImportRow} from './transportNormalInvoiceImport';

type Party={id:string;name:string};
type Account={id:string;name:string};
export default function TransportNormalInvoiceImport({side}:{side:NormalSide}){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const company=activeCompany?.company_id,bu=activeBusinessUnit?.business_unit_id,scope=`${company}/${bu}`;
 const ref=useRef<HTMLInputElement>(null),request=useRef(0),working=useRef(false);
 const [parties,setParties]=useState<Party[]>([]),[accounts,setAccounts]=useState<Account[]>([]);
 const [account,setAccount]=useState(''),[rows,setRows]=useState<NormalImportRow[]>([]);
 const [filename,setFilename]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{
  const id=++request.current;setParties([]);setAccounts([]);setRows([]);setFilename('');setError('');setMessage('');setAccount('');setLoading(true);
  if(!company||!bu){setLoading(false);return;}
  void Promise.all([
   supabase.from(side==='customer'?'customers':'suppliers').select('id,name').eq('company_id',company).eq('is_active',true).order('name'),
   supabase.from('chart_of_accounts').select('id,name').eq('company_id',company).eq('is_active',true).eq('is_group',false).eq('type',side==='customer'?'revenue':'expense').order('name'),
   supabase.from('account_mappings').select('account_id').eq('company_id',company).eq('mapping_key',side==='customer'?'sales_revenue':'cogs').limit(1).maybeSingle()
  ]).then(([partyList,accountList,mapping])=>{
   if(id!==request.current)return;
   if(partyList.error)throw partyList.error;if(accountList.error)throw accountList.error;if(mapping.error)throw mapping.error;
   setParties(partyList.data??[]);const acc=accountList.data??[];setAccounts(acc);
   if(acc.some(a=>a.id===mapping.data?.account_id))setAccount(mapping.data!.account_id);
  }).catch(e=>{if(id===request.current)setError(e.message||'Master data unavailable.')})
    .finally(()=>{if(id===request.current)setLoading(false)});
  return()=>{request.current++};
 },[company,bu,scope,side]);
 function download(){
  const party=side==='customer'?'Customer':'Supplier';
  downloadImportTemplate({
   filename:`NAVILO-Transport-Normal-${side==='customer'?'Sales':'Purchase'}-Import.xlsx`,sheetName:'Normal Invoices',
   title:`Trip-independent Normal ${side==='customer'?'Sales':'Purchase'} invoice import`,
   headers:['Invoice Group','Invoice No','Date',party,'Description','Amount','Reference','VAT Treatment'],
   example:['INV-1','ORIGINAL-1001','2026-10-17',`Replace with active ${party}`,'Description of service',500,'Optional reference','Master'],
   notes:[
    'No Trip, Vehicle, Driver or inventory item is required or created.',
    'Invoice Group identifies one invoice. Repeat group/name/date/number/reference for multiple description lines.',
    'Customer/Supplier name must match the active company Master exactly (case-insensitive).',
    'Select one active Revenue/Expense Account for this file. Lines post through canonical GL and AR/AP.',
    'VAT Treatment: Master, With VAT, or Without VAT; selection must match Customer/Supplier Master Cash/Credit rule.',
    'Credit Sales require the genuine original invoice number. Do not use H-S, YES, CLEARED or NO INVOICE.',
    'Maximum 200 lines or 50 invoices per batch. All invoices are atomic: any error rolls back the entire file.',
    'Choose Import & Post to update receivables, payables and ledgers. Payments remain separate.'
   ]
  });
 }
 async function choose(e:React.ChangeEvent<HTMLInputElement>){
  const file=e.target.files?.[0];e.target.value='';
  if(!file||working.current)return;
  if(!account){setError('Select Revenue/Expense Account first.');return;}
  const id=request.current;setBusy(true);setError('');setMessage('');setRows([]);setFilename('');
  try{
   if(file.size>5*1024*1024)throw new Error('Maximum Excel/CSV file size is 5 MB.');
   const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});
   const data=XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets[wb.SheetNames[0]],{defval:''});
   const parsed=parseNormalInvoiceImport(data,side,parties,account);
   if(id===request.current){setRows(parsed);setFilename(file.name);}
  }catch(e:any){if(id===request.current)setError(e?.message||'Invalid normal invoice file.');}
  finally{if(id===request.current)setBusy(false)}
 }
 async function run(post:boolean){
  if(working.current||!rows.length||busy)return;
  working.current=true;setBusy(true);setError('');setMessage('');
  const id=request.current;
  try{
   const result=await supabase.rpc('transport_normal_invoice_import_vat',{p_side:side,p_rows:rows,p_post:post});
   if(result.error)throw result.error;
   if(id===request.current){setMessage(`${result.data.invoices} ${side==='customer'?'Sale':'Purchase'} invoice(s), ${result.data.lines} description lines ${post?'POSTED to accounting':'saved as draft'}. No Trips created. Record receipts/payments separately.`);setRows([]);setFilename('');}
  }catch(e:any){if(id===request.current)setError(e?.message||'Import failed. Entire file rolled back if the server rejected it.');}
  finally{working.current=false;if(id===request.current)setBusy(false)}
 }
 const groups=new Set(rows.map(r=>r.batch_ref.toLowerCase())).size;
 const net=rows.reduce((a,r)=>a+Number(r.amount),0);
 const label=side==='customer'?'Sale':'Purchase';
 return <section aria-label={`Normal ${label} Import`} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
  <h3 className="font-bold text-sm">{label} Invoice Bulk Import — No Trips</h3>
  <p className="text-[11px] text-slate-600">Existing {side==='customer'?'Customer':'Supplier'} Master → descriptions and amounts → canonical {side==='customer'?'AR':'AP'} / GL / VAT. No Trip or stock movement.</p>
  <label className="block text-xs font-semibold">{side==='customer'?'Sales Revenue':'Purchase Expense'} Account
   <NaviloSearchableSelect nativeCompatibility preserveLabel aria-label={`Normal ${label} import account`} className="input mt-1 w-full" disabled={loading||busy} value={account}
     onChange={e=>{setAccount(e.target.value);setRows([]);setFilename('')}}>
    <option value="">Select active account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
   </NaviloSearchableSelect>
  </label>
  <div className="flex flex-wrap items-center gap-2">
   <button className="btn" type="button" onClick={download} disabled={busy}>Download Template</button>
   <button className="btn" type="button" onClick={()=>ref.current?.click()} disabled={loading||busy||!account}>Choose Excel/CSV</button>
   <input ref={ref} type="file" accept=".xlsx,.xls,.csv" className="hidden" aria-label={`Normal ${label} import file`} onChange={e=>void choose(e)}/>
   {filename&&<span className="text-xs text-slate-600">{filename}</span>}
  </div>
  {error&&<p role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}
  {message&&<p role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{message}</p>}
  {rows.length>0&&<div className="space-y-2">
   <p className="text-xs font-semibold">{groups} invoices · {rows.length} lines · Net SAR {net.toFixed(2)} (before VAT) · VAT follows each invoice group's selected Master-compatible treatment</p>
   <div className="max-h-48 overflow-auto border"><table className="w-full text-left text-xs">
    <thead className="sticky top-0 bg-slate-100"><tr>{['Invoice Group','Invoice No','Date',side==='customer'?'Customer':'Supplier','Description','Amount','VAT Treatment'].map(h=><th key={h} className="p-1">{h}</th>)}</tr></thead>
    <tbody>{rows.map((r,i)=><tr key={i} className="border-t"><td className="p-1">{r.batch_ref}</td><td className="p-1">{r.invoice_no||'Automatic Cash number'}</td><td className="p-1">{r.invoice_date}</td><td className="p-1">{parties.find(p=>p.id===r.party_id)?.name}</td><td className="p-1">{r.description}</td><td className="p-1 tabular-nums">{r.amount}</td><td className="p-1">{r.vat_choice==='master'?'Master':r.vat_choice==='with_vat'?'With VAT':'Without VAT'}</td></tr>)}</tbody>
   </table></div>
   <p className="text-xs text-amber-900">Import & Post creates real accounting entries for all invoices. If any invoice fails, the complete file rolls back.</p>
   <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className="btn" onClick={()=>void run(false)}>Import as Drafts</button>
    <button type="button" disabled={busy} className="btn-primary" onClick={()=>void run(true)}>{busy?'Importing…':`Import & Post ${groups} ${label} Invoices`}</button></div>
  </div>}
  <Link to={side==='customer'?'/sales/new?type=normal':'/purchase/new?type=normal'} className="text-xs text-blue-700 underline">Create Normal {label} manually →</Link>
 </section>;
}
