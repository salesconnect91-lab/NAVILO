import {downloadDailyTripTemplate,downloadHistoricalTemplate} from '@/modules/transport/transportImportTemplates';
import {downloadExcelTemplate} from '@/modules/accounting/journalImportTemplates';
import TransportExternalInvoiceImport from '@/modules/transport/TransportExternalInvoiceImport';
import NaviloSearchableSelect from "@/components/SearchableSelect";
import { ArrowRight, FileText, Landmark, Truck, Users, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect,useRef,useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { hasPermission, type ModuleKey } from "@/auth/permissions";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";
import { fetchAllPages } from "@/lib/fetchAllPages";
import {downloadImportTemplate} from "@/lib/importExcelTemplate";

type MasterKind="vehicles"|"drivers"|"truck_types"|"locations"|"vehicle_expense_types"|"vehicle_ownership";
const masterDefs:Record<MasterKind,{title:string;headers:string[];sample:(string|number)[]}>={
 vehicles:{title:"Vehicles",headers:["Vehicle No","Truck Type","Owner Type","Supplier","Effective From"],sample:["ABC-123","Flatbed","Company","","2026-10-04"]},
 drivers:{title:"Drivers",headers:["Driver Name","Driver Code","Mobile","Driver Type","Supplier","Identity No","Licence No","Licence Expiry"],sample:["Driver A","DRV-001","0500000000","Supplier","Supplier A","ID-001","LIC-001","2027-12-31"]},
 truck_types:{title:"Truck Types",headers:["Name"],sample:["Flatbed"]},
 locations:{title:"Locations",headers:["Name","City Area"],sample:["Dammam Port","Dammam"]},
 vehicle_expense_types:{title:"Vehicle Expense Types",headers:["Name","Expense Scope"],sample:["Tyre","Vehicle"]},
 vehicle_ownership:{title:"Vehicle Ownership History",headers:["Vehicle No","Owner Type","Supplier","Effective From","Effective To","Change Reason"],sample:["ABC-123","Supplier","Supplier A","2026-10-04","","Contract change"]}
};
type RateKind="customer"|"supplier"|"customer_charge";
const defs:Record<RateKind,{title:string;headers:string[];sample:(string|number)[]}>={
 customer:{title:"Customer Route Rates",headers:["Company","Truck Type","From","To","Rate","Effective From","Effective To"],sample:["Customer A","Flatbed","Dammam","Khobar",600,"2026-01-01","2026-12-31"]},
 supplier:{title:"Supplier Route Rates",headers:["Supplier","Truck Type","From","To","Rate","Effective From","Effective To"],sample:["Supplier A","Flatbed","Dammam","Khobar",450,"2026-01-01","2026-12-31"]},
 customer_charge:{title:"Customer Additional Charges",headers:["Company","Charge Code","Amount","Status","Effective From","Effective To"],sample:["Customer A","W",400,"Agreed","2026-01-01","2026-12-31"]}
};
const masterTemplateNotes:Record<MasterKind,string[]>={
 vehicles:['Vehicle Number and dated ownership are created together. Owner Type: Company or Supplier; Supplier required when supplier-owned.','Truck Type must already exist in this Transport business.'],
 drivers:['This import supports SUPPLIER drivers only. Company drivers must be linked to Employees via Driver Details.','Supplier must exist and be active. Identity, licence and mobile are optional.'],
 truck_types:['Name must be unique in the current Transport business.'],
 locations:['Name required; City Area optional.'],
 vehicle_expense_types:['Expense Scope must be Trip, Vehicle, or Both. No journal is posted.'],
 vehicle_ownership:['Vehicle must already exist. Owner Type: Company or Supplier.','Dates must not overlap existing Vehicle Ownership History; never invent a previous owner.']
};
const rateTemplateNotes:Record<RateKind,string[]>={
 customer:['Company means CUSTOMER NAME (not business unit). Names, Truck Type and From/To locations must match active masters.','Rate is nonnegative and periods cannot overlap.'],
 supplier:['Supplier, Truck Type and From/To must match active masters.','Rate is nonnegative and periods cannot overlap.'],
 customer_charge:['Company means CUSTOMER NAME. Charge Code must already exist in Charge Types master.','Status is Agreed (amount required) or Pending (amount ignored). Periods cannot overlap.']
};
const key=(v:string)=>v.trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
const iso=(v:any)=>{if(v instanceof Date)return v.toISOString().slice(0,10);if(typeof v==="number"){const d=XLSX.SSF.parse_date_code(v);return d?String(d.y).padStart(4,"0")+"-"+String(d.m).padStart(2,"0")+"-"+String(d.d).padStart(2,"0"):"";}const s=String(v??"").trim();if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;const d=new Date(s);return Number.isNaN(d.valueOf())?"":d.toISOString().slice(0,10)};


type CustomerMasterImportRow = {
 name:string; name_urdu:string; email:string; phone:string; address:string;
 tax_registration_status:"registered"|"unregistered"; ntn:string; strn:string; cnic:string; sourceRow:number;
};
const customerKey=(value:string)=>value.normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase();

function PartyMasterImportCard({canImport,kind}:{canImport:boolean;kind:"customer"|"supplier"}){
 const title=kind==="customer"?"Customer":"Supplier";
 const plural=kind==="customer"?"Customers":"Suppliers";
 const table=kind==="customer"?"customers":"suppliers";
 const {activeCompany,activeBusinessUnit}=useAuth();
 const scope=`${activeCompany?.company_id??""}:${activeBusinessUnit?.business_unit_id??""}`;
 const latestScope=useRef(scope); latestScope.current=scope;
 const input=useRef<HTMLInputElement>(null);
 const running=useRef(false);
 const [rows,setRows]=useState<CustomerMasterImportRow[]>([]);
 const [existing,setExisting]=useState<string[]>([]);
 const [previewScope,setPreviewScope]=useState("");
 const [preview,setPreview]=useState(false);
 const [file,setFile]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [message,setMessage]=useState("");
 useEffect(()=>{setRows([]);setExisting([]);setPreviewScope("");setFile("");setPreview(false);setError("");setMessage("")},[scope]);
 const refreshExisting=async()=>{
  const result=await fetchAllPages<{name:string}>((start,end)=>supabase.from(table).select("name").eq("company_id",activeCompany!.company_id).order("id").range(start,end));
  return new Set(result.map(party=>customerKey(party.name)));
 };
 const download=()=>{
  const headers=["Name","Urdu Name","Email","Phone","Address","Tax Status","NTN","STRN","CNIC"];
  downloadImportTemplate({filename:`NAVILO-${plural}-Import-Template.xlsx`,sheetName:plural,title:`${title} master import`,
   headers,example:[`Replace with ${title} name`,"","","","","unregistered","","",""],
   notes:[`1 to 200 ${title.toLowerCase()} rows. Existing same-company names are skipped; no opening balances/invoices.`,
    'Tax Status must be registered or unregistered. Registered parties require STRN or NTN.',
    'Urdu Name is optional. This is a Company-shared master; select the intended Company before importing.']});
 };
 const choose=async(event:React.ChangeEvent<HTMLInputElement>)=>{
  const selected=event.target.files?.[0];event.target.value="";
  if(!selected)return;
  setRows([]);setFile("");setError("");setMessage("");setPreview(false);
  const selectedScope=scope;
  try{
   if(!canImport||!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id)throw new Error("Select a Company and Business Unit with Master create permission.");
   if(selected.size>5*1024*1024)throw new Error(`Maximum ${kind} import file size is 5 MB.`);
   const wb=XLSX.read(await selected.arrayBuffer(),{type:"array"});
   const sheet=wb.Sheets[wb.SheetNames[0]];
   if(!sheet)throw new Error("Excel/CSV has no worksheet.");
   const raw=XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet,{defval:""});
   if(!raw.length||raw.length>200)throw new Error(`${title} import must contain 1 to 200 rows.`);
   const seen=new Set<string>();
   const mapped=raw.map((record,index)=>{
    const data=Object.fromEntries(Object.entries(record).map(([k,v])=>[key(k),String(v??"").trim()]));
    const name=data.name||data[`${kind}_name`]||data.party_name||"";
    const normalized=customerKey(name);
    if(!normalized)throw new Error(`Row ${index+2}: ${title} Name is required.`);
    if(seen.has(normalized))throw new Error(`Row ${index+2}: Duplicate ${kind} "${name}" in file.`);
    seen.add(normalized);
    const rawTax=(data.tax_status||data.tax_registration_status||"unregistered").toLowerCase();
    if(!["registered","unregistered"].includes(rawTax))throw new Error(`Row ${index+2}: Tax Status must be registered or unregistered.`);
    if(rawTax==="registered"&&!data.strn&&!data.ntn)throw new Error(`Row ${index+2}: Registered ${kind} requires STRN or NTN.`);
    return {name,name_urdu:data.urdu_name||data.name_urdu||"",email:data.email||"",
     phone:data.phone||data.mobile||"",address:data.address||"",
     tax_registration_status:rawTax as "registered"|"unregistered",
     ntn:data.ntn||"",strn:data.strn||"",cnic:data.cnic||"",sourceRow:index+2};
   });
   const current=await refreshExisting();
   if(latestScope.current!==selectedScope)throw new Error("Active workspace changed. Choose the file again.");
   setRows(mapped);setExisting([...current]);setPreviewScope(selectedScope);setFile(selected.name);setPreview(true);
  }catch(failure){setError(failure instanceof Error?failure.message:`Unable to read ${kind} import file.`);}
 };
 const run=async()=>{
  if(running.current||!rows.length)return;
  if(!canImport||!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id||previewScope!==scope){
   setError(`Active Company or Business Unit changed. Choose the ${kind} file again.`);return;
  }
  running.current=true;setBusy(true);setError("");setMessage("");
  const selectedScope=scope;
  let created=0;let skipped=0;
  const completed=new Set<string>();
  try{
   const existingNow=await refreshExisting();
   if(latestScope.current!==selectedScope)throw new Error("Workspace changed. Import stopped.");
   const pending=rows.filter(r=>!existingNow.has(customerKey(r.name)));
   skipped=rows.length-pending.length;
   if(!pending.length){setRows([]);setFile("");setPreview(false);setMessage(`All ${skipped} ${kind}(s) already exist. Nothing imported.`);return;}
   if(!window.confirm(`Create ${pending.length} ${title} Master(s) in the active Company? This imports names and optional contact/tax data ONLY. No opening balances or invoices will be posted.`))return;
   for(const item of pending){
    if(latestScope.current!==selectedScope)throw new Error("Workspace changed. Import stopped.");
    const result=await supabase.rpc(kind==="customer"?"create_customer_with_ar":"create_supplier_with_ap",{
     p_name:item.name,p_email:item.email||null,p_phone:item.phone||null,p_address:item.address||null
    });
    if(result.error)throw new Error(`Row ${item.sourceRow} (${item.name}): ${result.error.message}`);
    const createdCustomer=Array.isArray(result.data)?result.data[0]:result.data;
    created++;completed.add(customerKey(item.name));
    const attributes={
     ...(item.name_urdu?{name_urdu:item.name_urdu}:{}),
     ...(item.ntn?{ntn:item.ntn}:{}),
     ...(item.strn?{strn:item.strn}:{}),
     ...(item.cnic?{cnic:item.cnic}:{}),
     ...(item.tax_registration_status==="registered"?{tax_registration_status:"registered"}:{})
    };
    if(Object.keys(attributes).length){
     if(!createdCustomer?.id)throw new Error(`Row ${item.sourceRow}: ${title} created, but the server did not return its ID for tax/contact details.`);
     const updated=await supabase.from(table).update(attributes).eq("id",createdCustomer.id);
     if(updated.error)throw new Error(`Row ${item.sourceRow}: ${title} created, but details update failed: ${updated.error.message}`);
    }
   }
   if(latestScope.current===selectedScope){setRows([]);setFile("");setPreview(false);setMessage(`${created} ${kind}(s) imported; ${skipped} already existed. No accounting balances were posted.`);}
  }catch(failure){
   if(latestScope.current===selectedScope){
    setRows(previous=>previous.filter(item=>!completed.has(customerKey(item.name))));
    setExisting(previous=>[...previous,...completed]);
    setError(`${failure instanceof Error?failure.message:`${title} import failed.`} ${created} ${kind}(s) created before the error. Remaining rows are kept for retry; already-created names will be skipped.`);
   }
  }finally{
   if(created>0)window.dispatchEvent(new Event("navilo-master-data-changed"));
   running.current=false;setBusy(false);
  }
 };
 const existingKeys=new Set(existing);
 const already=rows.filter(item=>existingKeys.has(customerKey(item.name))).length;
 return <section className="flex flex-col rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
  <div className="flex items-center gap-2"><Users className="h-5 w-5 text-emerald-700"/><h2 className="text-sm font-bold text-slate-900">{plural}</h2></div>
  <p className="mt-2 text-xs leading-5 text-slate-600">{title} names and contact/tax details only. No opening balances or invoices are posted.</p>
  {canImport?<div className="mt-3 flex flex-wrap gap-2">
   <button type="button" className="btn h-9 text-xs" disabled={busy} onClick={download}>Download Template</button>
   <button type="button" className="btn h-9 text-xs" disabled={busy} onClick={()=>input.current?.click()}>Choose File</button>
   <input ref={input} type="file" accept=".xlsx,.xls,.csv" className="hidden" aria-label={`Select ${kind} import file`} onChange={e=>void choose(e)}/>
   <button type="button" className="btn h-9 text-xs" disabled={busy||!rows.length} onClick={()=>setPreview(value=>!value)}>Import Preview</button>
   <Link to={`/master-data/${table}`} className="inline-flex h-9 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-800">View {plural}<ArrowRight className="h-3.5 w-3.5"/></Link>
  </div>:<span className="mt-3 text-xs text-slate-500">No Master create permission</span>}
  {file&&<p className="mt-2 text-xs text-slate-600">{file} · {rows.length} row(s) · {already} already exist · {rows.length-already} new</p>}
  {error&&<p role="alert" className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}
  {message&&<p role="status" className="mt-2 rounded bg-emerald-50 p-2 text-xs text-emerald-700">{message}</p>}
  {preview&&rows.length>0&&<div className="mt-2">
   <div className="max-h-48 overflow-auto rounded border border-slate-200">
    <table className="w-full text-left text-[11px]">
     <thead className="sticky top-0 bg-slate-100"><tr><th className="p-1">Row</th><th className="p-1">{title} Name</th><th className="p-1">Tax</th><th className="p-1">Status</th></tr></thead>
     <tbody>{rows.slice(0,100).map(item=><tr key={item.sourceRow} className="border-t"><td className="p-1">{item.sourceRow}</td><td className="p-1">{item.name}</td><td className="p-1">{item.tax_registration_status}</td><td className="p-1">{existingKeys.has(customerKey(item.name))?"Already exists · skip":"New"}</td></tr>)}</tbody>
    </table>
    {rows.length>100&&<p className="p-1 text-xs">Preview shows first 100 rows.</p>}
   </div>
   <div className="mt-2 flex items-center justify-between gap-2">
    <p className="text-[11px] text-slate-600">Creates {kind} masters only. Existing names are skipped; imported rows are not rolled back if a later row fails.</p>
    <button type="button" className="btn-primary h-9 shrink-0 px-3 text-xs" disabled={busy||!canImport||rows.length===already} onClick={()=>void run()}>{busy?"Importing…":`Import ${rows.length-already} ${plural}`}</button>
   </div>
  </div>}
 </section>;
}

function ImportReview({rows,amountLabel="Total amount"}:{rows:Record<string,unknown>[];amountLabel?:string}){
 const amounts=rows.map(row=>row.amount).filter((value):value is number=>typeof value==="number"&&Number.isFinite(value));
 if(!amounts.length)return null;
 const total=amounts.reduce((sum,value)=>sum+Math.round(value*100),0)/100;
 return <p className="mt-2 text-xs font-semibold text-slate-700">{amountLabel}: {total.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})} · {rows.length} rows · Review the full file before saving. Tables show up to 100 rows; server validation runs on every row.</p>;
}

function ResultLink({to,children}:{to:string;children:React.ReactNode}){
 return <Link to={to} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-800">{children}<ArrowRight className="h-3.5 w-3.5"/></Link>;
}

function TransportMasterImports(){
 const {activeCompany,activeBusinessUnit}=useAuth(); const input=useRef<HTMLInputElement>(null);
 const [kind,setKind]=useState<MasterKind>("vehicles"),[rows,setRows]=useState<any[]>([]),[file,setFile]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const def=masterDefs[kind];
 const download=()=>downloadImportTemplate({filename:`NAVILO-Transport-${kind}-template.xlsx`,sheetName:"Masters",title:`Transport ${def.title}`,headers:def.headers,example:def.sample,notes:[...masterTemplateNotes[kind],"Maximum 500 rows. No financial posting."]});
 const choose=async(e:React.ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];if(!f||busy)return;setBusy(true);setRows([]);setFile("");setError("");setMessage("");try{const wb=XLSX.read(await f.arrayBuffer(),{type:"array",cellDates:true});const data=XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]],{defval:""});if(!data.length)throw new Error("File has no data rows.");const mapped=data.map((r:any)=>{const n=Object.fromEntries(Object.entries(r).map(([k,v])=>[key(k),v]));if(kind==="vehicles")return{vehicle_no:String(n.vehicle_no??"").trim(),truck_type:String(n.truck_type??"").trim(),owner_type:String(n.owner_type??"").trim(),supplier:String(n.supplier??"").trim(),effective_from:iso(n.effective_from)};if(kind==="drivers")return{driver_name:String(n.driver_name??"").trim(),driver_code:String(n.driver_code??"").trim(),mobile:String(n.mobile??"").trim(),driver_type:String(n.driver_type??"").trim(),supplier:String(n.supplier??"").trim(),identity_no:String(n.identity_no??"").trim(),licence_no:String(n.licence_no??"").trim(),licence_expiry:iso(n.licence_expiry)};if(kind==="truck_types")return{name:String(n.name??"").trim()};if(kind==="locations")return{name:String(n.name??"").trim(),city_area:String(n.city_area??"").trim()};if(kind==="vehicle_expense_types")return{name:String(n.name??"").trim(),expense_scope:String(n.expense_scope??"").trim()};return{vehicle_no:String(n.vehicle_no??"").trim(),owner_type:String(n.owner_type??"").trim(),supplier:String(n.supplier??"").trim(),effective_from:iso(n.effective_from),effective_to:iso(n.effective_to),change_reason:String(n.change_reason??"").trim()}});if(mapped.length>500)throw new Error("Maximum 500 rows per master import file.");if(kind==="drivers"&&mapped.some((row:any)=>row.driver_type.toLowerCase()!=="supplier"))throw new Error("Company drivers must be linked to an Employee. Open Employees → Driver Details. This template imports Supplier drivers only.");setRows(mapped);setFile(f.name)}catch(x:any){setRows([]);setError(x.message||"Unable to read file.")}finally{e.target.value="";setBusy(false)}};
 const run=async()=>{if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id){setError("Select active company and business unit.");return}if(!rows.length)return;
 setBusy(true);setError("");setMessage("");try{const r=await supabase.rpc("transport_import_master_rows",{p_kind:kind,p_rows:rows});if(r.error)throw r.error;setMessage(`${r.data?.imported??rows.length} master row(s) imported.`);setRows([]);setFile("")}catch(x:any){setError(x.message||"Import failed. No partial rows are kept from the failed transaction.")}finally{setBusy(false)}};
 return <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="text-sm font-bold">Transport Master Imports</h2><p className="text-xs text-slate-600">Creates master records only; no financial posting. Existing records are kept. For company drivers, use Employees → Driver Details; the Drivers template is for Supplier drivers.</p></div><Upload className="h-5 w-5 shrink-0 text-emerald-700"/></div>
  <div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-xs font-semibold">Master Type<NaviloSearchableSelect nativeCompatibility preserveLabel className="input mt-1 h-9 min-w-52" value={kind} disabled={busy} onChange={e=>{setKind(e.target.value as MasterKind);setRows([]);setFile("");setError("");setMessage("")}}>{(Object.keys(masterDefs) as MasterKind[]).map(k=><option key={k} value={k}>{masterDefs[k].title}</option>)}</NaviloSearchableSelect></label>
   <button className="btn h-9" onClick={download} disabled={busy}>Download Template</button><button className="btn h-9" onClick={()=>input.current?.click()} disabled={busy}>Choose File</button><input ref={input} className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={choose}/><button className="btn-primary h-9" disabled={busy||!rows.length} onClick={()=>void run()}>{busy?"Importing…":`Import ${rows.length||""} Rows`}</button></div>
  {file&&<p className="mt-2 text-xs text-slate-600">{file} · {rows.length} row(s) in preview. The server checks all rows; any invalid row rejects the whole file.</p>}
  {error&&<p role="alert" className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}{message&&<p role="status" className="mt-2 rounded bg-emerald-50 p-2 text-xs text-emerald-700">{message}</p>}
  {rows.length>0&&<ImportReview rows={rows}/>}
 {rows.length>0&&<div className="mt-3 max-h-52 overflow-auto border"><table className="w-full text-left text-[11px]"><thead className="sticky top-0 bg-slate-100"><tr>{Object.keys(rows[0]).map(h=><th key={h} className="p-1">{h.replaceAll("_"," ")}</th>)}</tr></thead><tbody>{rows.slice(0,100).map((r,i)=><tr key={i} className="border-t">{Object.values(r).map((v:any,j)=><td key={j} className="p-1">{String(v??"")}</td>)}</tr>)}</tbody></table>{rows.length>100&&<p className="p-1 text-xs">Preview shows first 100 rows.</p>}</div>}
 <ResultLink to={kind==="vehicles"?"/master-data/vehicles":kind==="drivers"?"/master-data/drivers":kind==="truck_types"?"/master-data/truck-types":kind==="locations"?"/master-data/transport-locations":kind==="vehicle_expense_types"?"/master-data/vehicle-expense-types":"/master-data/vehicle-ownership"}>View {def.title}</ResultLink></section>
}

function TransportRateImports(){
 const {activeCompany,activeBusinessUnit}=useAuth(); const input=useRef<HTMLInputElement>(null);
 const [kind,setKind]=useState<RateKind>("customer"),[rows,setRows]=useState<any[]>([]),[file,setFile]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const def=defs[kind];
 const download=()=>downloadImportTemplate({filename:`NAVILO-Transport-${kind}-template.xlsx`,sheetName:"Rates",title:`Transport ${def.title}`,headers:def.headers,example:def.sample,notes:[...rateTemplateNotes[kind],"Maximum 500 rows. No invoice, receipt or journal is posted."]});
 const choose=async(e:React.ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];if(!f||busy)return;setBusy(true);setRows([]);setFile("");setError("");setMessage("");try{const wb=XLSX.read(await f.arrayBuffer(),{type:"array",cellDates:true});const data=XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]],{defval:""});if(!data.length)throw new Error("File has no data rows.");const mapped=data.map((r:any)=>{const n=Object.fromEntries(Object.entries(r).map(([k,v])=>[key(k),v]));return kind==="customer"?{company:String(n.company??"").trim(),truck_type:String(n.truck_type??"").trim(),from:String(n.from??"").trim(),to:String(n.to??"").trim(),amount:Number(n.rate),effective_from:iso(n.effective_from),effective_to:iso(n.effective_to)}:kind==="supplier"?{supplier:String(n.supplier??"").trim(),truck_type:String(n.truck_type??"").trim(),from:String(n.from??"").trim(),to:String(n.to??"").trim(),amount:Number(n.rate),effective_from:iso(n.effective_from),effective_to:iso(n.effective_to)}:{company:String(n.company??"").trim(),charge_code:String(n.charge_code??"").trim(),amount:String(n.status??"Agreed").trim().toLowerCase()==="pending"?null:Number(n.amount),status:String(n.status??"Agreed").trim().toLowerCase(),effective_from:iso(n.effective_from),effective_to:iso(n.effective_to)}});if(mapped.length>500)throw new Error("Maximum 500 rows per rate import file.");setRows(mapped);setFile(f.name)}catch(x:any){setRows([]);setError(x.message||"Unable to read file.")}finally{e.target.value="";setBusy(false)}};
 const run=async()=>{if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id){setError("Select active company and business unit.");return}if(!rows.length)return;setBusy(true);setError("");setMessage("");try{const r=await supabase.rpc("transport_import_rate_rows",{p_kind:kind,p_rows:rows});if(r.error)throw r.error;setMessage(`${r.data?.imported??rows.length} rate row(s) imported.`);setRows([]);setFile("")}catch(x:any){setError(x.message||"Import failed. No partial rows are kept from the failed transaction.")}finally{setBusy(false)}};
 return <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="text-sm font-bold">Transport Rate Imports</h2><p className="text-xs text-slate-600">Saves agreed rates and charges only; no financial posting. Existing history is kept.</p></div><Upload className="h-5 w-5 shrink-0 text-emerald-700"/></div>
  <div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-xs font-semibold">Import Type<NaviloSearchableSelect nativeCompatibility preserveLabel className="input mt-1 h-9 min-w-52" value={kind} disabled={busy} onChange={e=>{setKind(e.target.value as RateKind);setRows([]);setFile("");setError("");setMessage("")}}>{(Object.keys(defs) as RateKind[]).map(k=><option key={k} value={k}>{defs[k].title}</option>)}</NaviloSearchableSelect></label>
   <button className="btn h-9" onClick={download} disabled={busy}>Download Template</button><button className="btn h-9" onClick={()=>input.current?.click()} disabled={busy}>Choose File</button><input ref={input} className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={choose}/>
   <button className="btn-primary h-9" disabled={busy||!rows.length} onClick={()=>void run()}>{busy?"Importing…":`Import ${rows.length||""} Rows`}</button></div>
  {file&&<p className="mt-2 text-xs text-slate-600">{file} · {rows.length} row(s) in preview. The server checks masters, dates and overlapping periods before saving.</p>}
  {error&&<p role="alert" className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}{message&&<p role="status" className="mt-2 rounded bg-emerald-50 p-2 text-xs text-emerald-700">{message}</p>}
  {rows.length>0&&<ImportReview rows={rows}/>}
 {rows.length>0&&<div className="mt-3 max-h-52 overflow-auto border"><table className="w-full text-left text-[11px]"><thead className="sticky top-0 bg-slate-100"><tr>{Object.keys(rows[0]).map(h=><th key={h} className="p-1">{h.replaceAll("_"," ")}</th>)}</tr></thead><tbody>{rows.slice(0,100).map((r,i)=><tr key={i} className="border-t">{Object.values(r).map((v:any,j)=><td key={j} className="p-1">{v==null?"Pending":String(v)}</td>)}</tr>)}</tbody></table>{rows.length>100&&<p className="p-1 text-xs">Preview shows first 100 rows.</p>}</div>}
 <ResultLink to="/transport?view=new">Open New Trip</ResultLink></section>
}


function TransportTransferTripImports(){
 const {activeCompany,activeBusinessUnit}=useAuth(); const input=useRef<HTMLInputElement>(null);
 const [rows,setRows]=useState<any[]>([]),[file,setFile]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const headers=["Source Company","Source Trip ID","Trip Date","Customer","Vehicle No","Driver","Driver Code","Truck Type","From Location","To Location","Job No","Sale Type","Notes"];
 const sample=["Parent NAVILO","TRIP-SOURCE-0001","2026-10-05","Customer A","ABC-123","Driver A","DRV-001","Flatbed","Origin","Destination","JOB-001","Credit","Imported from NAVILO"];
 const download=()=>{const ws=XLSX.utils.aoa_to_sheet([headers,sample]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Trips");XLSX.writeFile(wb,"NAVILO-Transport-Transfer-Trips-template.xlsx")};
 const exportCurrent=async()=>{setBusy(true);setError("");setMessage("");try{const all:any[]=[];let offset=0,total=0;do{const x=await supabase.rpc("transport_transfer_export_page",{p_limit:500,p_offset:offset});if(x.error)throw x.error;const page=Array.isArray(x.data?.rows)?x.data.rows:[];total=Number(x.data?.total_count??page.length);all.push(...page);offset+=page.length;if(!page.length)break;}while(all.length<total);const out=all.map((r:any)=>[r.source_company,r.source_trip_id,r.trip_date,r.customer??"",r.vehicle_no??"",r.driver??"",r.driver_code??"",r.truck_type??"",r.from_location??"",r.to_location??"",r.job_no??"",r.sale_type??"",r.notes??""]);const ws=XLSX.utils.aoa_to_sheet([headers,...out]);ws["!cols"]=headers.map(h=>({wch:Math.min(28,Math.max(12,h.length+3))}));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Trips");XLSX.writeFile(wb,"NAVILO-Transport-Transfer.xlsx");setMessage(`${all.length} Trip(s) exported for NAVILO transfer.`)}catch(x:any){setError(x.message||"Transfer export failed.")}finally{setBusy(false)}};
 const choose=async(e:React.ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];if(!f||busy)return;setBusy(true);setRows([]);setFile("");setError("");setMessage("");try{const wb=XLSX.read(await f.arrayBuffer(),{type:"array",cellDates:true});const data=XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]],{defval:""});if(!data.length)throw new Error("File has no data rows.");if(data.length>500)throw new Error("Maximum 500 Trip rows per transfer file.");const mapped=data.map((r:any)=>{const n=Object.fromEntries(Object.entries(r).map(([k,v])=>[key(k),v]));return{source_company:String(n.source_company??"").trim(),source_trip_id:String(n.source_trip_id??"").trim(),trip_date:iso(n.trip_date),customer:String(n.customer??"").trim(),vehicle_no:String(n.vehicle_no??"").trim(),driver:String(n.driver??"").trim(),driver_code:String(n.driver_code??"").trim(),truck_type:String(n.truck_type??"").trim(),from_location:String(n.from_location??"").trim(),to_location:String(n.to_location??"").trim(),po_do_job_no:String(n.job_no??"").trim()||null,sale_type:String(n.sale_type??"").trim()||null,notes:String(n.notes??"").trim()||null}});const seen=new Set<string>();for(const [i,r] of mapped.entries()){const k=(r.source_company+"|"+r.source_trip_id).toLowerCase();if(!r.source_company||!r.source_trip_id||!r.trip_date||!r.customer||!r.from_location||!r.to_location)throw new Error(`Row ${i+2}: Source Company, Source Trip ID, Trip Date, Customer ID, From and To are required.`);if(seen.has(k))throw new Error(`Row ${i+2}: duplicate Source Company + Source Trip ID.`);seen.add(k)}
 const preview=await Promise.all(mapped.map(async(r:any)=>{const m=await supabase.rpc("transport_resolve_transfer_masters",{p_customer:r.customer,p_vehicle_no:r.vehicle_no||null,p_driver_code:r.driver_code||null,p_driver_name:r.driver||null,p_truck_type:r.truck_type||null,p_from_location:r.from_location,p_to_location:r.to_location});if(m.error||m.data?.status!=="Resolved")return{...r,import_status:"Error",import_reason:m.error?.message??"One or more target-company masters could not be resolved."};const z={...r,customer_id:m.data.customer_id,vehicle_id:m.data.vehicle_id,driver_id:m.data.driver_id,truck_type_id:m.data.truck_type_id,from_location_id:m.data.from_location_id,to_location_id:m.data.to_location_id};const x=await supabase.rpc("transport_classify_source_trip",{p_source_company:z.source_company,p_source_trip_id:z.source_trip_id,p_trip_date:z.trip_date,p_customer_id:z.customer_id,p_vehicle_id:z.vehicle_id,p_driver_id:z.driver_id,p_from_location_id:z.from_location_id,p_to_location_id:z.to_location_id,p_po_do_job_no:z.po_do_job_no});return{...z,import_status:x.error?"Error":x.data?.status??"Error",import_reason:x.error?.message??x.data?.reason??""}}));setRows(preview);setFile(f.name)}catch(x:any){setRows([]);setError(x.message||"Unable to read transfer file.")}finally{e.target.value="";setBusy(false)}};
 const run=async()=>{if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id){setError("Select active company and business unit.");return}if(!rows.length||rows.some((r:any)=>r.import_status==="Error"))return;setBusy(true);setError("");setMessage("");try{const newRows=rows.filter((r:any)=>r.import_status==="New").map(({import_status,import_reason,customer,vehicle_no,driver,driver_code,truck_type,from_location_id,to_location_id,...r}:any)=>r);if(newRows.length){const x=await supabase.rpc("transport_create_source_trips",{p_request_id:crypto.randomUUID(),p_rows:newRows});if(x.error)throw x.error}for(const r of rows.filter((x:any)=>x.import_status==="Update")){const changes:any={trip_date:r.trip_date,customer_id:r.customer_id,truck_type_id:r.truck_type_id,from_location:r.from_location,to_location:r.to_location,from_location_id:r.from_location_id,to_location_id:r.to_location_id,po_do_job_no:r.po_do_job_no,sale_type:r.sale_type,notes:r.notes};const x=await supabase.rpc("transport_apply_source_trip_update",{p_source_company:r.source_company,p_source_trip_id:r.source_trip_id,p_changes:changes,p_vehicle_id:r.vehicle_id,p_driver_id:r.driver_id});if(x.error)throw x.error}setMessage(`Transfer complete: ${newRows.length} New, ${rows.filter((r:any)=>r.import_status==="Update").length} Updated, ${rows.filter((r:any)=>r.import_status==="Duplicate").length} Duplicate skipped.`);setRows([]);setFile("")}catch(x:any){setError(x.message||"Transfer import failed.")}finally{setBusy(false)}};
 return <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="text-sm font-bold">NAVILO → NAVILO Transport Transfer</h2><p className="text-xs text-slate-600">Copies trip records from another NAVILO company; no financial posting. Review new, updated, duplicate and rejected rows before importing.</p></div><Truck className="h-5 w-5 shrink-0 text-emerald-700"/></div><div className="mt-3 flex flex-wrap gap-2"><button className="btn h-9" onClick={download} disabled={busy}>Download Transfer Template</button><button className="btn h-9" onClick={()=>void exportCurrent()} disabled={busy}>Export Current NAVILO Trips</button><button className="btn h-9" onClick={()=>input.current?.click()} disabled={busy}>Choose File</button><input ref={input} className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={choose}/><button className="btn-primary h-9" disabled={busy||!rows.length||rows.some((r:any)=>r.import_status==="Error")} onClick={()=>void run()}>{busy?"Importing…":"Import Transfer"}</button></div>{file&&<p className="mt-2 text-xs text-slate-600">{file} · New {rows.filter((r:any)=>r.import_status==="New").length} · Update {rows.filter((r:any)=>r.import_status==="Update").length} · Duplicate {rows.filter((r:any)=>r.import_status==="Duplicate").length} · Error {rows.filter((r:any)=>r.import_status==="Error").length}</p>}{rows.some((r:any)=>r.import_status!=="New")&&<p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-800">Correct duplicate/error rows in the Excel, then upload again. Import stays blocked until every row is New.</p>}{error&&<p role="alert" className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}{message&&<p role="status" className="mt-2 rounded bg-emerald-50 p-2 text-xs text-emerald-700">{message}</p>}<ResultLink to="/transport?view=trips">View Trips</ResultLink></section>
}

function TransportSettlementImports(){
 const {activeCompany,activeBusinessUnit}=useAuth(); const input=useRef<HTMLInputElement>(null);
 const [rows,setRows]=useState<any[]>([]),[file,setFile]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const headers=["Source Reference","Side","Payment Date","Party","Document No","Amount","Account","Method"]; const sample=["RCPT-0001","Customer","2026-10-05","Customer A","INV-1001",10000,"Bank","Bank"];
 const download=()=>{const ws=XLSX.utils.aoa_to_sheet([headers,sample]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Settlements");XLSX.writeFile(wb,"NAVILO-Transport-Receipts-Payments-template.xlsx")};
 const choose=async(e:React.ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];if(!f||busy)return;setBusy(true);setRows([]);setFile("");setError("");setMessage("");try{const wb=XLSX.read(await f.arrayBuffer(),{type:"array",cellDates:true});const data=XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]],{defval:""});if(!data.length)throw new Error("File has no data rows.");const mapped=data.map((r:any)=>{const n=Object.fromEntries(Object.entries(r).map(([k,v])=>[key(k),v]));return{source_reference:String(n.source_reference??"").trim(),side:String(n.side??"").trim().toLowerCase(),payment_date:iso(n.payment_date),party:String(n.party??"").trim(),document_no:String(n.document_no??"").trim(),amount:Number(n.amount),account:String(n.account??"").trim(),method:String(n.method??"Bank").trim()}});if(mapped.length>500)throw new Error("Maximum 500 settlement rows per file.");const seen=new Set<string>();for(const [i,r] of mapped.entries()){const k=r.source_reference.toLowerCase();if(!r.source_reference||!/^(customer|supplier)$/.test(r.side)||!r.payment_date||!r.party||!r.document_no||!Number.isFinite(r.amount)||r.amount<=0||!r.account)throw new Error(`Row ${i+2}: Source Reference, Customer/Supplier Side, Date, Party, Document No, positive Amount and Account are required.`);if(seen.has(k))throw new Error(`Row ${i+2}: duplicate Source Reference in file.`);seen.add(k)}setRows(mapped);setFile(f.name)}catch(x:any){setRows([]);setError(x.message||"Unable to read file.")}finally{e.target.value="";setBusy(false)}};
 const run=async()=>{if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id){setError("Select active company and business unit.");return}if(!rows.length)return;setBusy(true);setError("");setMessage("");try{const x=await supabase.rpc("transport_import_settlements_batch",{p_rows:rows});if(x.error)throw x.error;setMessage(`${x.data?.posted??rows.length} receipt/payment row(s) posted. View Accounting ledgers and customer/supplier statements.`);setRows([]);setFile("")}catch(x:any){setError(x.message||"Settlement import failed. No partial rows are kept from the failed transaction.")}finally{setBusy(false)}};
 return <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="text-sm font-bold">Transport Receipts / Payments Import</h2><p className="text-xs text-slate-600">Posts customer receipts and supplier payments to accounts and settles the selected invoice/bill. Partial payments are allowed; overpayments are blocked.</p></div><Landmark className="h-5 w-5 shrink-0 text-emerald-700"/></div><div className="mt-3 flex flex-wrap gap-2"><button className="btn h-9" onClick={download} disabled={busy}>Download Template</button><button className="btn h-9" onClick={()=>input.current?.click()} disabled={busy}>Choose File</button><input ref={input} className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={choose}/><button className="btn-primary h-9" disabled={busy||!rows.length} onClick={()=>void run()}>{busy?"Posting…":`Post ${rows.length||""} Rows`}</button></div>{file&&<p className="mt-2 text-xs text-slate-600">{file} · {rows.length} row(s) in preview. Any invalid row rolls back the whole file.</p>}{error&&<p role="alert" className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}{message&&<p role="status" className="mt-2 rounded bg-emerald-50 p-2 text-xs text-emerald-700">{message}</p>}{rows.length>0&&<ImportReview rows={rows}/>}
 {rows.length>0&&<div className="mt-3 max-h-52 overflow-auto border"><table className="w-full text-left text-[11px]"><thead className="sticky top-0 bg-slate-100"><tr>{Object.keys(rows[0]).map(h=><th key={h} className="p-1">{h.replaceAll("_"," ")}</th>)}</tr></thead><tbody>{rows.slice(0,100).map((r,i)=><tr key={i} className="border-t">{Object.values(r).map((v:any,j)=><td key={j} className="p-1">{String(v??"")}</td>)}</tr>)}</tbody></table></div>}<ResultLink to="/accounting/ledgers">View Accounting ledgers</ResultLink></section>
}

function TransportInvoiceImports(){
 const {activeBusinessUnit}=useAuth();
 const [mode,setMode]=useState<'trips'|'external'>('trips');
 const isTransport=activeBusinessUnit?.business_unit_type==='transport';
 return <section aria-label="Transport invoice import steps" className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
  <div className="flex flex-wrap items-start justify-between gap-2">
   <div><h3 className="text-sm font-bold text-slate-900">Invoice Import</h3>
    <p className="mt-0.5 text-[11px] text-slate-600">Choose where your invoice comes from. Import creates drafts for review; it does not receive cash or post accounting entries.</p>
   </div>
   {isTransport&&<Link className="text-xs font-semibold text-blue-700 underline" to="/master-data/customers?tab=billing">Customer Cash/Credit settings → Customer Master</Link>}
  </div>
  <div className="flex flex-wrap items-center gap-2">
   <label htmlFor="transport-invoice-source" className="whitespace-nowrap text-xs font-bold text-slate-700">1 · Invoice source</label>
   <NaviloSearchableSelect nativeCompatibility preserveLabel id="transport-invoice-source" aria-label="Invoice source" wrapperClassName="min-w-[240px] max-w-[400px] flex-1" className="input h-9 text-xs" value={mode} onChange={e=>setMode(e.target.value as 'trips'|'external')}>
    <option value="trips">Existing NAVILO trips</option>
    <option value="external">Ready invoices from external source</option>
   </NaviloSearchableSelect>
  </div>
  <div className="flex flex-wrap gap-x-4 gap-y-1 border-y border-slate-100 py-2 text-[11px] font-medium text-slate-600" aria-label="Invoice import workflow">
   <span>2 · Download template</span><span>3 · Upload Excel</span><span>4 · Validate & review</span><span>5 · Import drafts</span>
  </div>
  {mode==='trips'?<TripLinkedInvoiceImports/>:<section className="rounded-md bg-slate-50/60 p-2"><h2 className="mb-2 text-sm font-bold text-slate-900">Transport Sales Invoice Import</h2><TransportExternalInvoiceImport/></section>}
 </section>;
}

function TripLinkedInvoiceImports(){
 const {activeCompany,activeBusinessUnit}=useAuth(); const input=useRef<HTMLInputElement>(null);
 const [rows,setRows]=useState<any[]>([]),[file,setFile]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const headers=["Source Company","Source Invoice ID","Invoice No","Invoice Date","Customer","Trip No","Vehicle No","Amount","VAT","Description"];
 const sample=["External Fleet","EXT-INV-1001","INV-1001","2026-10-05","Customer A","TRIP-0001","ABC-123",25000,"No","Transport service"];
 const download=()=>{const ws=XLSX.utils.aoa_to_sheet([headers,sample]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Invoices");XLSX.writeFile(wb,"NAVILO-Transport-Sales-Invoice-template.xlsx")};
 const choose=async(e:React.ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];if(!f||busy)return;setBusy(true);setRows([]);setFile("");setError("");setMessage("");try{const wb=XLSX.read(await f.arrayBuffer(),{type:"array",cellDates:true});const data=XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]],{defval:""});if(!data.length)throw new Error("File has no data rows.");const mapped=data.map((r:any)=>{const n=Object.fromEntries(Object.entries(r).map(([k,v])=>[key(k),v]));return{source_company:String(n.source_company??"").trim(),source_invoice_id:String(n.source_invoice_id??"").trim(),invoice_no:String(n.invoice_no??"").trim(),invoice_date:iso(n.invoice_date),customer:String(n.customer??"").trim(),trip_no:String(n.trip_no??"").trim(),vehicle_no:String(n.vehicle_no??"").trim(),amount:Number(n.amount),vat:/^(yes|y|true|1|tax)$/i.test(String(n.vat??"").trim()),description:String(n.description??"").trim()}});if(mapped.length>500)throw new Error("Maximum 500 invoice rows per file.");for(const [i,r] of mapped.entries()){if(!r.source_company||!r.source_invoice_id||!r.invoice_no||!r.invoice_date||!r.customer||!r.trip_no||!r.vehicle_no||!Number.isFinite(r.amount)||r.amount<=0)throw new Error(`Row ${i+2}: Source Company, Source Invoice ID, Invoice No, Date, Customer, Trip No, Vehicle No and positive Amount are required.`)}const preview=await supabase.rpc("transport_preview_customer_invoice_batch",{p_rows:mapped});if(preview.error)throw preview.error;setRows(preview.data?.rows??mapped);setFile(f.name)}catch(x:any){setRows([]);setError(x.message||"Unable to read file.")}finally{e.target.value="";setBusy(false)}};
 const run=async()=>{if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id){setError("Select active company and business unit.");return}if(!rows.length)return;const blocked=rows.filter((r:any)=>r.import_status!=="New");if(blocked.length){setError(`Import blocked: ${blocked.length} row(s) are Duplicate/Error. Resolve them before importing.`);return}setBusy(true);setError("");setMessage("");try{const x=await supabase.rpc("transport_import_customer_invoice_batch",{p_rows:rows.map(({import_status,import_reason,...r}:any)=>r)});if(x.error)throw x.error;setMessage(`${x.data?.invoices??0} draft Sales Invoice(s), ${x.data?.trip_rows??rows.length} Trip row(s) imported atomically. Review them in Sales before posting.`);setRows([]);setFile("")}catch(x:any){setError(x.message||"Invoice import failed. No rows from this file were imported.")}finally{setBusy(false)}};
 return <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="text-sm font-bold">Transport Sales Invoice Import</h2><p className="text-xs text-slate-600">Creates draft Sales invoices only. Review and post them in Sales to update receivables and VAT. Trip No and Vehicle No must match.</p></div><FileText className="h-5 w-5 shrink-0 text-emerald-700"/></div>
 <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="btn h-9" onClick={download} disabled={busy}>Download Template</button><button type="button" className="btn h-9" onClick={()=>input.current?.click()} disabled={busy}>Choose File</button><input ref={input} aria-label="Trip-linked invoice file" className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={choose}/></div>
 {file&&<p className="mt-2 text-xs text-slate-600">{file} · {rows.length} row(s) checked · New {rows.filter((r:any)=>r.import_status==="New").length} · Duplicate {rows.filter((r:any)=>r.import_status==="Duplicate").length} · Error {rows.filter((r:any)=>r.import_status==="Error").length}. Import is enabled only when every row is New.</p>}{error&&<p role="alert" className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}{message&&<p role="status" className="mt-2 rounded bg-emerald-50 p-2 text-xs text-emerald-700">{message}</p>}
 {rows.length>0&&<ImportReview rows={rows}/>}
 {rows.length>0&&<div className="mt-3 max-h-52 overflow-auto border"><table className="w-full text-left text-[11px]"><thead className="sticky top-0 bg-slate-100"><tr>{Object.keys(rows[0]).map(h=><th key={h} className="p-1">{h.replaceAll("_"," ")}</th>)}</tr></thead><tbody>{rows.slice(0,100).map((r,i)=><tr key={i} className="border-t">{Object.values(r).map((v:any,j)=><td key={j} className="p-1">{typeof v==="boolean"?(v?"Yes":"No"):String(v??"")}</td>)}</tr>)}</tbody></table></div>}
 <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
  <button type="button" className="btn-primary h-9" disabled={busy||!rows.length||rows.some((r:any)=>r.import_status!=="New")} onClick={()=>void run()}>{busy?"Importing…":`Import ${rows.length||""} Rows`}</button>
  <ResultLink to="/sales">View Sales invoices</ResultLink>
 </div>
 </section>
}

export default function ImportCenter() {
  const { activeCompany, activeBusinessUnit, isPlatformOwner } = useAuth();
  const role = activeBusinessUnit?.membership_role ?? activeCompany?.membership_role;
  const permissions = activeBusinessUnit?.permissions ?? activeCompany?.permissions;
  const canImport = (module: ModuleKey) => (activeCompany?.enabled_modules?.includes(module) ?? true) && (activeBusinessUnit?.enabled_modules.includes(module) ?? true) && (isPlatformOwner || hasPermission(role, module, "create", permissions, false));
  const scope=`${activeCompany?.company_id??""}:${activeBusinessUnit?.business_unit_id??""}`;
  return <div className="w-full space-y-2 py-2">
   <div><h1 className="text-base font-bold text-slate-900">Import Center</h1><p className="text-xs text-slate-600">1. Download template → 2. Choose file → 3. Review rows → 4. Import. Invoices and journals are saved as drafts; receipts/payments are posted.</p></div>
   <nav aria-label="Import sections" className="flex flex-wrap gap-2 text-xs"><a className="btn" href="#import-masters">Masters &amp; rates</a><a className="btn" href="#import-daily">Trips &amp; invoices</a><a className="btn" href="#import-accounting">Receipts &amp; journals</a><a className="btn" href="#import-history">Historical &amp; transfer</a></nav>
   <div key={scope} className="space-y-3">
    <ImportGroup id="import-masters" title="1. Masters & rates" detail="Set up names, vehicles and agreed rates. No accounting entries.">
     <div className="grid gap-2 lg:grid-cols-2"><PartyMasterImportCard kind="customer" canImport={canImport("master")}/><PartyMasterImportCard kind="supplier" canImport={canImport("master")}/></div>
     {canImport("transport")&&<><TransportMasterImports/><TransportRateImports/></>}
    </ImportGroup>
    {canImport("transport")&&<ImportGroup id="import-daily" title="2. Daily trips & sales invoices" detail="Have invoices from an external source? Use Ready invoices below. Upload trips only when you need trip records.">
     <ImportEntry title="Daily Trip Upload" effect="Trip records only" detail="Upload current trips. No invoice, receipt or journal is posted." to="/transport?view=new&import=bulk" label="Open Daily Trip Upload" download={downloadDailyTripTemplate}/>
     {canImport("sales")&&<TransportInvoiceImports/>}
    </ImportGroup>}
    {(canImport("accounting")||canImport("transport"))&&<ImportGroup id="import-accounting" title="3. Receipts, payments & journal entries" detail="Record actual money received or paid. Use journals for other accounting entries.">
     {canImport("transport")&&canImport("accounting")&&<TransportSettlementImports/>}
     <ImportEntry title="Bulk Journal Entries" effect="Drafts first; post after review" detail="One Entry No and Description per journal; add balanced debit and credit rows. Account code is optional. Post after review in Accounting." to="/accounting?import=journal" label="Open Journal Import" download={downloadExcelTemplate}/>
    </ImportGroup>}
    {canImport("transport")&&<ImportGroup id="import-history" title="4. Historical records & company transfer" detail="Use only when bringing in old records or moving trip records between NAVILO companies.">
     <ImportEntry title="One-time Historical Import" effect="Historical accounting import" detail="Old trips, invoices, expenses and settlements. Review cutoff, opening balances and accounts before posting." to="/transport?view=new&import=historical" label="Open Historical Import" download={downloadHistoricalTemplate}/>
     <details className="rounded border bg-slate-50 p-2"><summary className="cursor-pointer text-xs font-semibold">Company-to-company trip transfer · optional</summary><div className="mt-2"><TransportTransferTripImports/></div></details>
    </ImportGroup>}
   </div>
  </div>;
}
function ImportGroup({id,title,detail,children}:{id:string;title:string;detail:string;children:React.ReactNode}){
 return <fieldset id={id} className="scroll-mt-14 space-y-2 rounded border border-slate-200 p-2"><legend className="px-1 text-sm font-bold text-slate-900">{title}</legend><p className="text-xs text-slate-600">{detail}</p>{children}</fieldset>;
}

function ImportEntry({title,effect,detail,to,label,download}:{title:string;effect:string;detail:string;to:string;label:string;download:()=>void}){
 return <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><h2 className="text-sm font-bold text-slate-900">{title}</h2><p className="mt-1 text-xs font-semibold text-emerald-800">{effect}</p><p className="mt-1 text-xs text-slate-600">{detail}</p><div className="mt-2 flex flex-wrap items-center gap-2"><button type="button" className="btn" onClick={download}>Download Template</button><Link className="btn-primary" to={to}>{label}</Link></div></section>;
}
