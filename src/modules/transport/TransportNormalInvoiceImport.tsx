import {useEffect,useRef,useState} from 'react';
import * as XLSX from 'xlsx';
import {Link} from 'react-router-dom';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import {downloadImportTemplate} from '@/lib/importExcelTemplate';
import NaviloSearchableSelect from '@/components/SearchableSelect';
import {parseNormalInvoiceImport,type NormalSide,type NormalImportRow,type NormalImportVehicle} from './transportNormalInvoiceImport';
import {fetchAllPages} from '@/lib/fetchAllPages';

type Party={id:string;name:string};
type Account={id:string;name:string};
type DuplicateMatch={company?:string|null;trips?:string[];date?:string|null;status?:string|null;restricted?:boolean};
export default function TransportNormalInvoiceImport({side}:{side:NormalSide}){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const company=activeCompany?.company_id,bu=activeBusinessUnit?.business_unit_id,scope=`${company}/${bu}`;
 const ref=useRef<HTMLInputElement>(null),request=useRef(0),working=useRef(false);
 const [parties,setParties]=useState<Party[]>([]),[accounts,setAccounts]=useState<Account[]>([]),[vehicles,setVehicles]=useState<NormalImportVehicle[]>([]);
 const [account,setAccount]=useState(''),[rows,setRows]=useState<NormalImportRow[]>([]);
 const [filename,setFilename]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[message,setMessage]=useState('');
 const [duplicateAllowed,setDuplicateAllowed]=useState(false),[duplicateConflicts,setDuplicateConflicts]=useState<Array<{invoice_no:string;matches:DuplicateMatch[]}>>([]),[duplicateConfirmed,setDuplicateConfirmed]=useState(false),[conflictLoading,setConflictLoading]=useState(false),[conflictError,setConflictError]=useState('');
 useEffect(()=>{
  const id=++request.current;setParties([]);setAccounts([]);setVehicles([]);setRows([]);setFilename('');setError('');setMessage('');setAccount('');setDuplicateAllowed(false);setDuplicateConflicts([]);setDuplicateConfirmed(false);setConflictError('');setLoading(true);
  if(!company||!bu){setLoading(false);return;}
  void Promise.all([
   supabase.from(side==='customer'?'customers':'suppliers').select('id,name').eq('company_id',company).eq('is_active',true).order('name'),
   supabase.from('chart_of_accounts').select('id,name').eq('company_id',company).eq('is_active',true).eq('is_group',false).eq('type',side==='customer'?'revenue':'expense').order('name'),
   supabase.from('account_mappings').select('account_id').eq('company_id',company).eq('mapping_key',side==='customer'?'sales_revenue':'cogs').limit(1).maybeSingle(),
   supabase.rpc('transport_invoice_duplicate_override_allowed',{p_side:side}),
   Promise.all([
    fetchAllPages<{id:string;vehicle_no:string;ownership_type:string|null}>(
     (from,to)=>supabase.from('transport_vehicles').select('id,vehicle_no,ownership_type')
      .eq('company_id',company).eq('business_unit_id',bu).eq('is_active',true).order('id').range(from,to),500),
    fetchAllPages<{vehicle_id:string;owner_type:string;effective_from:string;effective_to:string|null}>(
     (from,to)=>supabase.from('transport_vehicle_ownership').select('vehicle_id,owner_type,effective_from,effective_to')
      .eq('company_id',company).eq('business_unit_id',bu).order('id').range(from,to),500)
   ]).then(([master,history])=>master.map(v=>({...v,
    ownershipPeriods:history.filter(o=>o.vehicle_id===v.id).map(({owner_type,effective_from,effective_to})=>({owner_type,effective_from,effective_to}))
   })))
  ]).then(([partyList,accountList,mapping,duplicatePermission,vehicleList])=>{
   if(id!==request.current)return;
   if(partyList.error)throw partyList.error;if(accountList.error)throw accountList.error;if(mapping.error)throw mapping.error;if(duplicatePermission.error)throw duplicatePermission.error;
   setDuplicateAllowed(duplicatePermission.data===true);
   setVehicles(vehicleList.filter(v=>v.ownership_type==='company'||v.ownershipPeriods.some(o=>o.owner_type==='company')));
   // Purchases must choose a real expense ledger explicitly; COGS is not the default for overhead or vehicle repairs.
   const mapped=side==='customer'?(mapping.data?.account_id??''):'';
   const acc=(accountList.data??[]).filter(a=>side!=='customer'||a.id===mapped);
   if(side==='customer'&&(!mapped||acc.length!==1))
     throw new Error('Active Sales Revenue mapping required for Normal Sale import.');
   setParties(partyList.data??[]);setAccounts(acc);
   if(acc.some(a=>a.id===mapped))setAccount(mapped);
  }).catch(e=>{if(id===request.current)setError(e.message||'Master data unavailable.')})
    .finally(()=>{if(id===request.current)setLoading(false)});
  return()=>{request.current++};
 },[company,bu,scope,side]);
 function download(){
  const party=side==='customer'?'Customer':'Supplier';
  downloadImportTemplate({
   filename:`NAVILO-Transport-Normal-${side==='customer'?'Sales':'Purchase'}-Import.xlsx`,sheetName:'Normal Invoices',
   title:`Trip-independent Normal ${side==='customer'?'Sales':'Purchase'} invoice import`,
   headers:['Invoice Group','Invoice No','Date',party,'Description','Vehicle No','Amount','Reference','VAT Treatment'],
   example:['INV-1','ORIGINAL-1001','2026-10-17',`Replace with active ${party}`,'Description of service',side==='customer'?'Company Vehicle No required':'Optional company Vehicle No',500,'Optional reference','Master'],
   notes:[
    side==='customer'?'No Trip or stock movement. Every Sale line REQUIRES a valid company-owned Vehicle No.':'No Trip or stock movement. Vehicle No is OPTIONAL on Purchase lines: enter company-owned vehicle for vehicle P&L, leave blank only for office/yard/general overhead.',
    'Invoice Group identifies one invoice. Repeat group/name/date/number/reference for multiple description lines.',
    'Customer/Supplier name must match the active company Master exactly (case-insensitive).',
    'Select one active Revenue/Expense Account for this file. Lines post through canonical GL and AR/AP.',
    'VAT Treatment: Master, With VAT, or Without VAT; selection must match Customer/Supplier Master Cash/Credit rule.',
    'Credit Sales require the genuine original invoice number. Do not use H-S, YES, CLEARED or NO INVOICE.',
    'Maximum 200 lines or 50 invoices per batch. All invoices are atomic: any error rolls back the entire file.',
    'Every imported invoice is saved as a draft. Review and post it manually from the invoice detail screen. Payments remain separate.'
   ]
  });
 }
 async function choose(e:React.ChangeEvent<HTMLInputElement>){
  const file=e.target.files?.[0];e.target.value='';
  if(!file||working.current)return;
  if(!account){setError('Select Revenue/Expense Account first.');return;}
  const id=request.current;setBusy(true);setError('');setMessage('');setRows([]);setFilename('');
  let parsedForConflictCheck=false;
  try{
   if(file.size>5*1024*1024)throw new Error('Maximum Excel/CSV file size is 5 MB.');
   const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});
   const data=XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets[wb.SheetNames[0]],{defval:''});
   const parsed=parseNormalInvoiceImport(data,side,parties,account,vehicles);
   parsedForConflictCheck=true;
   const invoiceNumbers=[...new Set(parsed.map(row=>row.invoice_no.trim()).filter(Boolean))];
   setConflictLoading(invoiceNumbers.length>0);setDuplicateConfirmed(false);setDuplicateConflicts([]);setConflictError('');
   const conflicts=await Promise.all(invoiceNumbers.map(async invoice_no=>{
    const result=await supabase.rpc('transport_invoice_number_conflicts',{p_side:side,p_number:invoice_no});
    if(result.error)throw result.error;
    const matches=(result.data?.matches??[]) as DuplicateMatch[];
    return matches.length?{invoice_no,matches}:null;
   }));
   if(id===request.current){setRows(parsed);setFilename(file.name);setDuplicateConflicts(conflicts.filter((value):value is {invoice_no:string;matches:DuplicateMatch[]}=>Boolean(value)));}
  }catch(e:any){if(id===request.current){if(parsedForConflictCheck)setConflictError(e?.message||'Could not check invoice numbers before import.');else setError(e?.message||'Invalid normal invoice file.');}}
  finally{if(id===request.current){setConflictLoading(false);setBusy(false)}}
 }
 async function run(){
  if(working.current||!rows.length||busy)return;
  working.current=true;setBusy(true);setError('');setMessage('');
  const id=request.current;
  try{
   const result=await supabase.rpc('transport_normal_invoice_import_vat_with_override',{p_side:side,p_rows:rows,p_post:false,p_allow_duplicate_invoice:duplicateConflicts.length>0&&duplicateAllowed&&duplicateConfirmed});
   if(result.error)throw result.error;
   if(id===request.current){setMessage(`${result.data.invoices} ${side==='customer'?'Sale':'Purchase'} invoice(s), ${result.data.lines} description lines saved as draft. Review and post invoices manually. No Trips created. Record receipts/payments separately.`);setRows([]);setFilename('');setDuplicateConflicts([]);setDuplicateConfirmed(false);}
  }catch(e:any){if(id===request.current)setError(e?.message||'Import failed. Entire file rolled back if the server rejected it.');}
  finally{working.current=false;if(id===request.current)setBusy(false)}
 }
 const groups=new Set(rows.map(r=>r.batch_ref.toLowerCase())).size;
 const net=rows.reduce((a,r)=>a+Number(r.amount),0);
 const label=side==='customer'?'Sale':'Purchase';
 const blockedByDuplicate=duplicateConflicts.length>0&&(!duplicateAllowed||!duplicateConfirmed);
 return <section aria-label={`Normal ${label} Import`} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
  <h3 className="font-bold text-sm">{label} Invoice Bulk Import — No Trips</h3>
  <p className="text-xs font-medium text-amber-800">{side==='customer'
   ?'Normal Sales require Vehicle No on every line.'
   :'Normal Purchases: Vehicle No optional. For vehicle repairs/diesel enter valid company vehicle on each related line; for Office/Yard leave blank.'}
   {' '}Vehicle Master ownership must be valid on invoice date. <Link className="underline" to="/master-data/vehicle-ownership">Check ownership</Link>.</p>
  <p className="text-[11px] text-slate-600">Existing {side==='customer'?'Customer':'Supplier'} Master → descriptions and amounts → canonical {side==='customer'?'AR':'AP'} / GL / VAT. No Trip or stock movement. {vehicles.length} eligible company-owned vehicles loaded.</p>
  {side==='supplier'&&<p className="text-[11px] text-amber-900">Choose the expense GL for this file explicitly (for example Rent, Utilities or General Expenses). Do not put Office/Yard repairs under COGS just because it was previously the default. Different expense accounts require separate import files.</p>}
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
  {conflictError&&<p role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{conflictError}</p>}
  {message&&<p role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{message}</p>}
  {rows.length>0&&<div className="space-y-2">
   <p className="text-xs font-semibold">{groups} invoices · {rows.length} lines · Net SAR {net.toFixed(2)} (before VAT) · VAT follows each invoice group's selected Master-compatible treatment</p>
   <div className="max-h-48 overflow-auto border"><table className="w-full text-left text-xs">
    <thead className="sticky top-0 bg-slate-100"><tr>{['Invoice Group','Invoice No','Date',side==='customer'?'Customer':'Supplier','Description','Vehicle No','Amount','VAT Treatment'].map(h=><th key={h} className="p-1">{h}</th>)}</tr></thead>
    <tbody>{rows.map((r,i)=><tr key={i} className="border-t"><td className="p-1">{r.batch_ref}</td><td className="p-1">{r.invoice_no||'Automatic Cash number'}</td><td className="p-1">{r.invoice_date}</td><td className="p-1">{parties.find(p=>p.id===r.party_id)?.name}</td><td className="p-1">{r.description}</td><td className="p-1">{vehicles.find(v=>v.id===r.vehicle_id)?.vehicle_no||'—'}</td><td className="p-1 tabular-nums">{r.amount}</td><td className="p-1">{r.vat_choice==='master'?'Master':r.vat_choice==='with_vat'?'With VAT':'Without VAT'}</td></tr>)}</tbody>
   </table></div>
   {conflictLoading&&<p role="status" className="text-xs text-slate-600">Checking invoice numbers across accessible companies…</p>}
   {duplicateConflicts.length>0&&<div role="status" className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950">
    <strong>Invoice number already used. Check each match before import:</strong>
    <ul className="mt-1 list-inside list-disc">{duplicateConflicts.flatMap(conflict=>conflict.matches.map((match,index)=><li key={`${conflict.invoice_no}-${index}`}><b>{conflict.invoice_no}</b> · {match.restricted?'Restricted company':match.company||'Company'} · {match.date||'Date unavailable'} · {match.status||'record'}{match.trips?.length?` · Trip ${match.trips.join(', ')}`:''}</li>))}</ul>
    {duplicateAllowed?<label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={duplicateConfirmed} onChange={e=>setDuplicateConfirmed(e.target.checked)}/><span>I have permission to save these duplicate invoice numbers.</span></label>:<p className="mt-2 font-semibold">Only an authorized company owner, admin, or user with duplicate-invoice permission can continue.</p>}
   </div>}
   <p className="text-xs text-amber-900">Imported invoices remain drafts. Review each invoice and post it manually from its detail screen.</p>
   <div className="flex flex-wrap gap-2"><button type="button" disabled={busy||conflictLoading||Boolean(conflictError)||blockedByDuplicate} className="btn-primary" onClick={()=>void run()}>{busy?'Importing…':`Import ${groups} ${label} Invoice Drafts`}</button></div>
  </div>}
  <Link to={side==='customer'?'/sales/new?type=normal':'/purchase/new?type=normal'} className="text-xs text-blue-700 underline">Create Normal {label} manually →</Link>
 </section>;
}
