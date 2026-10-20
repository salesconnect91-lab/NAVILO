import {useEffect,useRef,useState} from 'react';
import * as XLSX from 'xlsx';
import {Link} from 'react-router-dom';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import {downloadImportTemplate} from '@/lib/importExcelTemplate';
import {parseGeneralExpenseImport,type ExpenseImportRow} from './generalExpenseImport';
type Opt={id:string;name:string};
export default function GeneralExpenseBillImport(){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const company=activeCompany?.company_id,bu=activeBusinessUnit?.business_unit_id;
 const input=useRef<HTMLInputElement>(null),lock=useRef(false);
 const [suppliers,setSuppliers]=useState<Opt[]>([]),[accounts,setAccounts]=useState<Opt[]>([]);
 const [rows,setRows]=useState<ExpenseImportRow[]>([]),[name,setName]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{let live=true;setRows([]);setSuppliers([]);setAccounts([]);setLoading(true);
  if(!company||!bu){setLoading(false);return;}
  void Promise.all([
   supabase.from('suppliers').select('id,name').eq('company_id',company).eq('is_active',true).order('name'),
   supabase.from('chart_of_accounts').select('id,name').eq('company_id',company).eq('type','expense').eq('is_active',true).eq('is_group',false).order('name')
  ]).then(([s,a])=>{if(!live)return;if(s.error)throw s.error;if(a.error)throw a.error;
    setSuppliers(s.data??[]);setAccounts(a.data??[]);
  }).catch(e=>{if(live)setError(e.message||'Cannot load Masters');}).finally(()=>{if(live)setLoading(false)});
  return()=>{live=false};
 },[company,bu]);
 function template(){downloadImportTemplate({
  filename:'NAVILO-General-Expense-Invoices-Import.xlsx',sheetName:'Expense Invoices',
  title:'Non-inventory supplier Expense Invoice import (all companies)',
  headers:['Invoice Group','Supplier Invoice No','Date','Supplier','Expense Account','Description','Amount','VAT Treatment'],
  example:['EXP-01','SUP-REF-101','2026-10-19','Exact Supplier Master','Exact Expense COA','Office repairs',100,'With VAT'],
  notes:['Each invoice group must share supplier, original invoice, date, expense account and VAT treatment.',
   'VAT Treatment: With VAT or Without VAT. The configured effective Purchase VAT rate applies.',
   'Transport supplier Cash/Credit VAT Master Billing Rules are enforced server-side.',
   'Post creates Expense, Input VAT and Accounts Payable ledgers; no inventory stock movements.',
   'For Office vs Yard reporting use separate active Expense GL accounts. Description alone does not split the P&L. Set these up in Accounting > Chart of Accounts before posting.',
   'Do not import a Cash/Bank-paid voucher as a new credit bill if the same expense has already been recognized.',
   'Maximum 200 lines / 50 invoices. One failed invoice rolls back the entire batch.']
 });}
 async function choose(e:React.ChangeEvent<HTMLInputElement>){
  const f=e.target.files?.[0];e.target.value='';if(!f||lock.current)return;
  setBusy(true);setError('');setRows([]);setName('');
  try{
   if(f.size>5*1024*1024)throw Error('Maximum 5 MB file');
   const wb=XLSX.read(await f.arrayBuffer(),{type:'array',cellDates:true});
   const data=XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets[wb.SheetNames[0]],{defval:''});
   const found=parseGeneralExpenseImport(data,suppliers,accounts);setRows(found);setName(f.name);
  }catch(e:any){setError(e?.message||'Invalid spreadsheet');}finally{setBusy(false);}
 }
 async function upload(post:boolean){
  if(lock.current||!rows.length)return;lock.current=true;setBusy(true);setError('');setMessage('');
  try{const r=await supabase.rpc('general_expense_bill_import',{p_rows:rows,p_post:post});
   if(r.error)throw r.error;
   setMessage(`${r.data.invoices} supplier expense invoices ${post?'posted':'saved as drafts'}; ${r.data.lines} lines. No stock movement.`);setRows([]);setName('');
  }catch(e:any){setError(e?.message||'Expense import rejected. All rows rolled back.');}
  finally{lock.current=false;setBusy(false);}
 }
 const groups=new Set(rows.map(x=>x.batch_ref.toLowerCase())).size;
 const amount=rows.reduce((s,x)=>s+Number(x.amount),0);
 return <section className="space-y-3 p-3" aria-label="Expense Invoice Excel Import">
  <div className="flex items-center justify-between"><div><h1 className="text-lg font-bold">Expense Invoice Excel Import</h1><p className="text-xs text-slate-600">Original supplier bills • With/without VAT • no inventory or Trip linkage</p></div><Link to="/purchase" className="text-blue-700 underline">Back to Purchases</Link></div>
  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
    <strong>Office / Yard GL setup:</strong> If you want separate Office and Yard expense totals on P&amp;L, create distinct active expense posting accounts first. Descriptions do not create cost centres. <Link className="font-semibold underline" to="/accounting/accounts">Open Chart of Accounts</Link>. Supplier bills create Payables; pay them once through Supplier Payment. Do not duplicate already-paid expenses.
  </div>
  <div className="flex gap-2 flex-wrap"><button className="btn" onClick={template}>Download Excel Template</button><button className="btn-primary" disabled={loading||busy} onClick={()=>input.current?.click()}>Choose Excel/CSV</button><input className="hidden" ref={input} type="file" aria-label="Expense invoice import file" accept=".xlsx,.xls,.csv" onChange={e=>void choose(e)}/></div>
  {name&&<p>{name}</p>}{error&&<p role="alert" className="text-red-700">{error}</p>}{message&&<p role="status" className="text-emerald-800">{message}</p>}
  {rows.length>0&&<div className="space-y-2">
   <p><strong>{groups} invoices • {rows.length} lines • Net SAR {amount.toFixed(2)}</strong></p>
   <div className="max-h-80 overflow-auto rounded border"><table className="w-full text-left text-xs"><thead><tr><th>Invoice Group</th><th>Supplier</th><th>Original No.</th><th>Net</th><th>VAT</th></tr></thead><tbody>{rows.map((r,i)=><tr key={i} className="border-t"><td>{r.batch_ref}</td><td>{suppliers.find(x=>x.id===r.supplier_id)?.name}</td><td>{r.supplier_invoice_no}</td><td>{r.amount}</td><td>{r.vat_choice==='with_vat'?'With VAT':'Without VAT'}</td></tr>)}</tbody></table></div>
   <div className="flex gap-2"><button className="btn" disabled={busy} onClick={()=>void upload(false)}>Import Drafts</button><button className="btn-primary" disabled={busy} onClick={()=>void upload(true)}>Import & Post</button></div>
  </div>}
 </section>;
}
