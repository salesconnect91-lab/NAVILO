import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import * as XLSX from 'xlsx';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import {fetchAllPages} from '@/lib/fetchAllPages';
import SearchableSelect from '@/components/SearchableSelect';
import {parseExternalInvoiceRows,type ExternalInvoiceRow} from './transportExternalInvoiceImport';
type Preview=ExternalInvoiceRow&{import_status:string;import_reason:string};
export default function TransportExternalInvoiceImport(){
 const {activeCompany,activeBusinessUnit}=useAuth();const scope=`${activeCompany?.company_id}/${activeBusinessUnit?.business_unit_id}`;
 const input=useRef<HTMLInputElement>(null);const generation=useRef(0);const submitting=useRef(false);
 const [source,setSource]=useState(''),[account,setAccount]=useState(''),[accounts,setAccounts]=useState<{id:string;name:string}[]>([]),[rows,setRows]=useState<Preview[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[file,setFile]=useState('');
 useEffect(()=>{const request=++generation.current;setRows([]);setFile('');setError('');setMessage('');setAccount('');setSource('');setAccounts([]);setBusy(false);
 if(!activeCompany?.company_id)return;
 void Promise.all([fetchAllPages<{id:string;name:string}>((from,to)=>supabase.from('chart_of_accounts').select('id,name').eq('company_id',activeCompany.company_id).eq('type','revenue').eq('is_active',true).eq('is_group',false).order('id').range(from,to)),supabase.from('account_mappings').select('account_id').eq('company_id',activeCompany.company_id).eq('mapping_key','sales_revenue').maybeSingle()]).then(([list,mapping])=>{if(request!==generation.current)return;if(mapping.error)throw mapping.error;setAccounts(list);if(list.some(a=>a.id===mapping.data?.account_id))setAccount(mapping.data!.account_id);}).catch(e=>{if(request===generation.current)setError(e.message)});
 return()=>{generation.current++};
 },[scope]);
 function download(){const headers=['TRIP NO.','DATE','TRUCK TYPE','PO-DO-JOB NO.','INVOICED','Invoice / Bill Date','COMPANY NAME','DRIVER NAME-MOBILE','OWNER','PLATE #','FROM','TO','RATE WITH COMPANY','TAX (%)','TAX AMOUNT','BILL AMOUNT','Cash/Credit','Discription'];const sample=['16512','2026-06-04','Small Dyna','PO007206','2026-03098','2026-08-31','Customer A','Driver','Owner','7979','Dammam','Haith',3000,15,450,3450,'Credit','Transport service'];const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([headers,sample]),'Invoices');XLSX.writeFile(wb,'NAVILO-External-Transport-Invoices.xlsx');}
 async function choose(e:React.ChangeEvent<HTMLInputElement>){const selected=e.target.files?.[0];e.target.value='';if(!selected||submitting.current||busy)return;const request=generation.current;setBusy(true);setError('');setMessage('');setRows([]);setFile('');try{if(selected.size>5*1024*1024)throw new Error('Maximum file size is 5 MB.');if(!source.trim())throw new Error('Enter the source company.');const wb=XLSX.read(await selected.arrayBuffer(),{type:'array',cellDates:true});const data=parseExternalInvoiceRows(XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets[wb.SheetNames[0]],{defval:''}));if(request!==generation.current)return;const preview=await supabase.rpc('transport_preview_external_invoices',{p_source_company:source.trim(),p_rows:data});if(preview.error)throw preview.error;if(request===generation.current){setRows(preview.data.rows);setFile(selected.name);}}catch(e:any){if(request===generation.current)setError(e.message||'Unable to read invoices.');}finally{if(request===generation.current)setBusy(false);}}
 async function run(){if(submitting.current||busy||!account||!rows.length||rows.some(r=>r.import_status!=='New'))return;const request=generation.current;submitting.current=true;setBusy(true);setError('');setMessage('');try{const result=await supabase.rpc('transport_import_external_invoices',{p_source_company:source.trim(),p_revenue_account_id:account,p_rows:rows.map(({import_status,import_reason,...r})=>r)});if(result.error)throw result.error;if(request===generation.current){setMessage(`${result.data.invoices} draft invoice(s) / cash bill(s), ${result.data.lines} vehicle lines imported. Review and post in Sales. No trips or receipts were created.`);setRows([]);setFile('');}}catch(e:any){if(request===generation.current)setError(e.message||'Import failed.');}finally{submitting.current=false;if(request===generation.current)setBusy(false);}}
 const totals=rows.reduce((a,r)=>({net:a.net+r.amount,vat:a.vat+r.tax_amount,total:a.total+r.bill_amount}),{net:0,vat:0,total:0});

 const ready=rows.filter(r=>r.import_status==='New').length;
 const blocked=rows.length-ready;
 return <div className="space-y-3">
  <p className="text-[11px] text-slate-600">Ready invoices do not create NAVILO trips. The Excel invoice number and Invoice / Bill Date are used. Current import validation requires zero VAT for Cash and positive VAT for Credit; payments are recorded separately.</p>
  <div className="grid gap-2 sm:grid-cols-2">
   <label className="text-xs font-semibold text-slate-700">Source company
    <input className="input mt-1 w-full" aria-label="External source company" placeholder="Company shown in source Excel" value={source} disabled={busy} onChange={e=>{setSource(e.target.value);setRows([]);setFile('');}}/>
   </label>
   <label className="text-xs font-semibold text-slate-700">Sales revenue account
    <SearchableSelect nativeCompatibility preserveLabel aria-label="External revenue account" className="input mt-1 w-full" value={account} disabled={busy} onChange={e=>setAccount(e.target.value)}>
     <option value="">Select revenue account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
    </SearchableSelect>
   </label>
  </div>
  <div className="flex flex-wrap items-center gap-2">
   <button type="button" className="btn" disabled={busy} onClick={download}>Download Template</button>
   <button type="button" className="btn-primary" disabled={busy} onClick={()=>input.current?.click()}>Choose File</button>
   <input ref={input} type="file" accept=".xlsx,.xls,.csv" aria-label="External invoice file" className="hidden" onChange={e=>void choose(e)}/>
   {file&&<span className="text-[11px] font-medium text-slate-600">{file}</span>}
  </div>
  {error&&<p role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">{error}</p>}
  {message&&<p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700">{message}</p>}
  {rows.length>0&&<section aria-label="External invoice preview" className="space-y-2 rounded-lg border border-slate-200 bg-white p-2">
   <div className="flex flex-wrap items-center justify-between gap-2">
    <h3 className="text-xs font-bold text-slate-900">Preview · {rows.length} invoice lines</h3>
    <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
     <span className="text-emerald-700">Ready {ready}</span>
     {blocked>0&&<span className="text-red-700">Needs correction {blocked}</span>}
     <span className="text-slate-600">Net {totals.net.toFixed(2)} · VAT {totals.vat.toFixed(2)} · Total {totals.total.toFixed(2)}</span>
    </div>
   </div>
   {blocked>0&&<p className="rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">Import is blocked until every error/duplicate is corrected in the Excel and the file is uploaded again.</p>}
   <div className="max-h-64 overflow-auto rounded border border-slate-200">
    <table className="w-full text-left text-[11px]">
     <thead className="sticky top-0 bg-slate-100"><tr>{['Invoice','Invoice date','Customer','Type','Vehicle','Net','VAT','Total','Status','Reason'].map(h=><th key={h} className="whitespace-nowrap px-2 py-1.5">{h}</th>)}</tr></thead>
     <tbody>{rows.map((r,i)=><tr key={`${r.source_reference}-${i}`} className={`border-t ${r.import_status==='New'?'':'bg-rose-50/50'}`}>
      <td className="whitespace-nowrap px-2 py-1">{r.invoice_no||'Auto cash bill'}</td>
      <td className="whitespace-nowrap px-2 py-1">{r.invoice_date}</td>
      <td className="px-2 py-1">{r.customer}</td>
      <td className="px-2 py-1">{r.sale_type}</td>
      <td className="px-2 py-1">{r.vehicle_no}</td>
      <td className="px-2 py-1 tabular-nums">{Number(r.amount).toFixed(2)}</td>
      <td className="px-2 py-1 tabular-nums">{Number(r.tax_amount).toFixed(2)}</td>
      <td className="px-2 py-1 tabular-nums">{Number(r.bill_amount).toFixed(2)}</td>
      <td className={`px-2 py-1 font-semibold ${r.import_status==='New'?'text-emerald-700':'text-red-700'}`}>{r.import_status}</td>
      <td className="px-2 py-1 text-red-700">{r.import_reason}</td>
     </tr>)}</tbody>
    </table>
   </div>
  </section>}
  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
   <button type="button" className="btn-primary" disabled={busy||!source.trim()||!account||!rows.length||blocked>0} onClick={()=>void run()}>{busy?'Checking…':'Import Draft Invoices'}</button>
   <Link className="text-xs font-semibold text-blue-700 underline" to="/sales">Review Sales invoices / cash bills →</Link>
  </div>
  <p className="text-[11px] text-slate-500">Import saves drafts only. Customer Cash/Credit rules are checked using the selected Transport business; no receipt or payment is created here.</p>
 </div>;
}
