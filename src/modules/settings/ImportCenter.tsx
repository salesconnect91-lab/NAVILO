import NaviloSearchableSelect from "@/components/SearchableSelect";
import { ArrowRight, FileText, Landmark, Truck, Users, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect,useRef,useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { hasPermission, type ModuleKey } from "@/auth/permissions";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";

type MasterKind="vehicles"|"drivers"|"truck_types"|"locations"|"vehicle_expense_types"|"vehicle_ownership";
const masterDefs:Record<MasterKind,{title:string;headers:string[];sample:(string|number)[]}>={
 vehicles:{title:"Vehicles",headers:["Vehicle No","Truck Type","Owner Type","Supplier","Effective From"],sample:["ABC-123","Flatbed","Company","","2026-10-04"]},
 drivers:{title:"Drivers",headers:["Driver Name","Driver Code","Mobile","Driver Type","Supplier","Identity No","Licence No","Licence Expiry"],sample:["Driver A","DRV-001","0500000000","Company","","ID-001","LIC-001","2027-12-31"]},
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
const key=(v:string)=>v.trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
const iso=(v:any)=>{if(v instanceof Date)return v.toISOString().slice(0,10);if(typeof v==="number"){const d=XLSX.SSF.parse_date_code(v);return d?String(d.y).padStart(4,"0")+"-"+String(d.m).padStart(2,"0")+"-"+String(d.d).padStart(2,"0"):"";}const s=String(v??"").trim();if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;const d=new Date(s);return Number.isNaN(d.valueOf())?"":d.toISOString().slice(0,10)};


type CustomerMasterImportRow = {
 name:string; name_urdu:string; email:string; phone:string; address:string;
 tax_registration_status:"registered"|"unregistered"; ntn:string; strn:string; cnic:string; sourceRow:number;
};
const customerKey=(value:string)=>value.normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase();

function CustomerMasterImportCard({canImport}:{canImport:boolean}){
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
  const result=await supabase.from("customers").select("name");
  if(result.error)throw result.error;
  return new Set((result.data??[]).map((customer:{name:string})=>customerKey(customer.name)));
 };
 const download=()=>{
  const headers=["Name","Urdu Name","Email","Phone","Address","Tax Status","NTN","STRN","CNIC"];
  const ws=XLSX.utils.aoa_to_sheet([headers,["Sample Customer","","","","","unregistered","","",""]]);
  ws["!cols"]=[{wch:50},...headers.slice(1).map(()=>({wch:20}))];
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"Customers");
  XLSX.writeFile(wb,"NAVILO-Customers-Import-Template.xlsx");
 };
 const choose=async(event:React.ChangeEvent<HTMLInputElement>)=>{
  const selected=event.target.files?.[0];event.target.value="";
  if(!selected)return;
  setRows([]);setFile("");setError("");setMessage("");setPreview(false);
  const selectedScope=scope;
  try{
   if(!canImport||!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id)throw new Error("Select a Company and Business Unit with Master create permission.");
   if(selected.size>5*1024*1024)throw new Error("Maximum customer import file size is 5 MB.");
   const wb=XLSX.read(await selected.arrayBuffer(),{type:"array"});
   const sheet=wb.Sheets[wb.SheetNames[0]];
   if(!sheet)throw new Error("Excel/CSV has no worksheet.");
   const raw=XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet,{defval:""});
   if(!raw.length||raw.length>200)throw new Error("Customer import must contain 1 to 200 rows.");
   const seen=new Set<string>();
   const mapped=raw.map((record,index)=>{
    const data=Object.fromEntries(Object.entries(record).map(([k,v])=>[key(k),String(v??"").trim()]));
    const name=data.name||data.customer_name||data.party_name||"";
    const normalized=customerKey(name);
    if(!normalized)throw new Error(`Row ${index+2}: Customer Name is required.`);
    if(seen.has(normalized))throw new Error(`Row ${index+2}: Duplicate customer "${name}" in file.`);
    seen.add(normalized);
    const rawTax=(data.tax_status||data.tax_registration_status||"unregistered").toLowerCase();
    if(!["registered","unregistered"].includes(rawTax))throw new Error(`Row ${index+2}: Tax Status must be registered or unregistered.`);
    if(rawTax==="registered"&&!data.strn&&!data.ntn)throw new Error(`Row ${index+2}: Registered customer requires STRN or NTN.`);
    return {name,name_urdu:data.urdu_name||data.name_urdu||"",email:data.email||"",
     phone:data.phone||data.mobile||"",address:data.address||"",
     tax_registration_status:rawTax as "registered"|"unregistered",
     ntn:data.ntn||"",strn:data.strn||"",cnic:data.cnic||"",sourceRow:index+2};
   });
   const current=await refreshExisting();
   if(latestScope.current!==selectedScope)throw new Error("Active workspace changed. Choose the file again.");
   setRows(mapped);setExisting([...current]);setPreviewScope(selectedScope);setFile(selected.name);setPreview(true);
  }catch(failure){setError(failure instanceof Error?failure.message:"Unable to read customer import file.");}
 };
 const run=async()=>{
  if(running.current||!rows.length)return;
  if(!canImport||!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id||previewScope!==scope){
   setError("Active Company or Business Unit changed. Choose the customer file again.");return;
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
   if(!pending.length){setRows([]);setFile("");setPreview(false);setMessage(`All ${skipped} customer(s) already exist. Nothing imported.`);return;}
   if(!window.confirm(`Create ${pending.length} Customer Master(s) in the active Company? This imports names and optional contact/tax data ONLY. No opening balances or invoices will be posted.`))return;
   for(const item of pending){
    if(latestScope.current!==selectedScope)throw new Error("Workspace changed. Import stopped.");
    const result=await supabase.rpc("create_customer_with_ar",{
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
     if(!createdCustomer?.id)throw new Error(`Row ${item.sourceRow}: Customer created, but the server did not return its ID for tax/contact details.`);
     const updated=await supabase.from("customers").update(attributes).eq("id",createdCustomer.id);
     if(updated.error)throw new Error(`Row ${item.sourceRow}: Customer created, but details update failed: ${updated.error.message}`);
    }
   }
   if(latestScope.current===selectedScope){setRows([]);setFile("");setPreview(false);setMessage(`${created} customer(s) imported; ${skipped} already existed. No accounting balances were posted.`);}
  }catch(failure){
   if(latestScope.current===selectedScope){
    setRows(previous=>previous.filter(item=>!completed.has(customerKey(item.name))));
    setExisting(previous=>[...previous,...completed]);
    setError(`${failure instanceof Error?failure.message:"Customer import failed."} ${created} customer(s) created before the error. Remaining rows are kept for retry; already-created names will be skipped.`);
   }
  }finally{
   if(created>0)window.dispatchEvent(new Event("navilo-master-data-changed"));
   running.current=false;setBusy(false);
  }
 };
 const existingKeys=new Set(existing);
 const already=rows.filter(item=>existingKeys.has(customerKey(item.name))).length;
 return <section className="flex flex-col rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
  <div className="flex items-center gap-2"><Users className="h-5 w-5 text-emerald-700"/><h2 className="text-sm font-bold text-slate-900">Customers</h2></div>
  <p className="mt-2 text-xs leading-5 text-slate-600">Excel/CSV Customer Master import with preview. No opening balances are posted.</p>
  {canImport?<div className="mt-3 flex flex-wrap gap-2">
   <button type="button" className="btn h-9 text-xs" disabled={busy} onClick={download}>Download Template</button>
   <button type="button" className="btn h-9 text-xs" disabled={busy} onClick={()=>input.current?.click()}>Upload Excel / CSV</button>
   <input ref={input} type="file" accept=".xlsx,.xls,.csv" className="hidden" aria-label="Select customer import file" onChange={e=>void choose(e)}/>
   <button type="button" className="btn h-9 text-xs" disabled={busy||!rows.length} onClick={()=>setPreview(value=>!value)}>Import Preview</button>
   <Link to="/master-data/customers" className="inline-flex h-9 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-800">Open customer import<ArrowRight className="h-3.5 w-3.5"/></Link>
  </div>:<span className="mt-3 text-xs text-slate-500">No Master create permission</span>}
  {file&&<p className="mt-2 text-xs text-slate-600">{file} · {rows.length} row(s) · {already} already exist · {rows.length-already} new</p>}
  {error&&<p role="alert" className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}
  {message&&<p role="status" className="mt-2 rounded bg-emerald-50 p-2 text-xs text-emerald-700">{message}</p>}
  {preview&&rows.length>0&&<div className="mt-2">
   <div className="max-h-48 overflow-auto rounded border border-slate-200">
    <table className="w-full text-left text-[11px]">
     <thead className="sticky top-0 bg-slate-100"><tr><th className="p-1">Row</th><th className="p-1">Customer Name</th><th className="p-1">Tax</th><th className="p-1">Status</th></tr></thead>
     <tbody>{rows.slice(0,100).map(item=><tr key={item.sourceRow} className="border-t"><td className="p-1">{item.sourceRow}</td><td className="p-1">{item.name}</td><td className="p-1">{item.tax_registration_status}</td><td className="p-1">{existingKeys.has(customerKey(item.name))?"Already exists · skip":"New"}</td></tr>)}</tbody>
    </table>
    {rows.length>100&&<p className="p-1 text-xs">Preview shows first 100 rows.</p>}
   </div>
   <div className="mt-2 flex items-center justify-between gap-2">
    <p className="text-[11px] text-slate-600">Creates customer masters only. Existing names are skipped; imported rows are not rolled back if a later row fails.</p>
    <button type="button" className="btn-primary h-9 shrink-0 px-3 text-xs" disabled={busy||!canImport||rows.length===already} onClick={()=>void run()}>{busy?"Importing…":`Import ${rows.length-already} Customers`}</button>
   </div>
  </div>}
 </section>;
}

function TransportMasterImports(){
 const {activeCompany,activeBusinessUnit}=useAuth(); const input=useRef<HTMLInputElement>(null);
 const [kind,setKind]=useState<MasterKind>("vehicles"),[rows,setRows]=useState<any[]>([]),[file,setFile]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const def=masterDefs[kind];
 const download=()=>{const ws=XLSX.utils.aoa_to_sheet([def.headers,def.sample]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Masters");XLSX.writeFile(wb,`NAVILO-Transport-${kind}-template.xlsx`)};
 const choose=async(e:React.ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];if(!f)return;setError("");setMessage("");try{const wb=XLSX.read(await f.arrayBuffer(),{type:"array",cellDates:true});const data=XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]],{defval:""});if(!data.length)throw new Error("File has no data rows.");const mapped=data.map((r:any)=>{const n=Object.fromEntries(Object.entries(r).map(([k,v])=>[key(k),v]));if(kind==="vehicles")return{vehicle_no:String(n.vehicle_no??"").trim(),truck_type:String(n.truck_type??"").trim(),owner_type:String(n.owner_type??"").trim(),supplier:String(n.supplier??"").trim(),effective_from:iso(n.effective_from)};if(kind==="drivers")return{driver_name:String(n.driver_name??"").trim(),driver_code:String(n.driver_code??"").trim(),mobile:String(n.mobile??"").trim(),driver_type:String(n.driver_type??"").trim(),supplier:String(n.supplier??"").trim(),identity_no:String(n.identity_no??"").trim(),licence_no:String(n.licence_no??"").trim(),licence_expiry:iso(n.licence_expiry)};if(kind==="truck_types")return{name:String(n.name??"").trim()};if(kind==="locations")return{name:String(n.name??"").trim(),city_area:String(n.city_area??"").trim()};if(kind==="vehicle_expense_types")return{name:String(n.name??"").trim(),expense_scope:String(n.expense_scope??"").trim()};return{vehicle_no:String(n.vehicle_no??"").trim(),owner_type:String(n.owner_type??"").trim(),supplier:String(n.supplier??"").trim(),effective_from:iso(n.effective_from),effective_to:iso(n.effective_to),change_reason:String(n.change_reason??"").trim()}});if(mapped.length>500)throw new Error("Maximum 500 rows per master import file.");setRows(mapped);setFile(f.name)}catch(x:any){setRows([]);setError(x.message||"Unable to read file.")}finally{e.target.value=""}};
 const run=async()=>{if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id){setError("Select active company and business unit.");return}if(!rows.length)return;
 setBusy(true);setError("");setMessage("");try{const r=await supabase.rpc("transport_import_master_rows",{p_kind:kind,p_rows:rows});if(r.error)throw r.error;setMessage(`${r.data?.imported??rows.length} master row(s) imported.`);setRows([]);setFile("")}catch(x:any){setError(x.message||"Import failed. No partial rows are kept from the failed transaction.")}finally{setBusy(false)}};
 return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
  <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-bold">Transport Master Imports</h2><p className="text-xs text-slate-600">Bulk-create Transport masters from Excel/CSV. Existing records and historical evidence are never overwritten.</p></div><Upload className="h-5 w-5 text-emerald-700"/></div>
  <div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-xs font-semibold">Master Type<NaviloSearchableSelect nativeCompatibility preserveLabel className="input mt-1 h-9 min-w-52" value={kind} disabled={busy} onChange={e=>{setKind(e.target.value as MasterKind);setRows([]);setFile("");setError("");setMessage("")}}>{(Object.keys(masterDefs) as MasterKind[]).map(k=><option key={k} value={k}>{masterDefs[k].title}</option>)}</NaviloSearchableSelect></label>
   <button className="btn h-9" onClick={download} disabled={busy}>Download Template</button><button className="btn h-9" onClick={()=>input.current?.click()} disabled={busy}>Choose Excel / CSV</button><input ref={input} className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={choose}/><button className="btn-primary h-9" disabled={busy||!rows.length} onClick={()=>void run()}>{busy?"Importing…":`Import ${rows.length||""} Rows`}</button></div>
  {file&&<p className="mt-2 text-xs text-slate-600">{file} · {rows.length} row(s) ready. The import is atomic: one invalid row rejects the whole file.</p>}
  {error&&<p role="alert" className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}{message&&<p role="status" className="mt-2 rounded bg-emerald-50 p-2 text-xs text-emerald-700">{message}</p>}
  {rows.length>0&&<div className="mt-3 max-h-52 overflow-auto border"><table className="w-full text-left text-[11px]"><thead className="sticky top-0 bg-slate-100"><tr>{Object.keys(rows[0]).map(h=><th key={h} className="p-1">{h.replaceAll("_"," ")}</th>)}</tr></thead><tbody>{rows.slice(0,100).map((r,i)=><tr key={i} className="border-t">{Object.values(r).map((v:any,j)=><td key={j} className="p-1">{String(v??"")}</td>)}</tr>)}</tbody></table>{rows.length>100&&<p className="p-1 text-xs">Preview shows first 100 rows.</p>}</div>}
 </section>
}

function TransportRateImports(){
 const {activeCompany,activeBusinessUnit}=useAuth(); const input=useRef<HTMLInputElement>(null);
 const [kind,setKind]=useState<RateKind>("customer"),[rows,setRows]=useState<any[]>([]),[file,setFile]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const def=defs[kind];
 const download=()=>{const ws=XLSX.utils.aoa_to_sheet([def.headers,def.sample]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Rates");XLSX.writeFile(wb,`NAVILO-Transport-${kind}-template.xlsx`)};
 const choose=async(e:React.ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];if(!f)return;setError("");setMessage("");try{const wb=XLSX.read(await f.arrayBuffer(),{type:"array",cellDates:true});const data=XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]],{defval:""});if(!data.length)throw new Error("File has no data rows.");const mapped=data.map((r:any)=>{const n=Object.fromEntries(Object.entries(r).map(([k,v])=>[key(k),v]));return kind==="customer"?{company:String(n.company??"").trim(),truck_type:String(n.truck_type??"").trim(),from:String(n.from??"").trim(),to:String(n.to??"").trim(),amount:Number(n.rate),effective_from:iso(n.effective_from),effective_to:iso(n.effective_to)}:kind==="supplier"?{supplier:String(n.supplier??"").trim(),truck_type:String(n.truck_type??"").trim(),from:String(n.from??"").trim(),to:String(n.to??"").trim(),amount:Number(n.rate),effective_from:iso(n.effective_from),effective_to:iso(n.effective_to)}:{company:String(n.company??"").trim(),charge_code:String(n.charge_code??"").trim(),amount:String(n.status??"Agreed").trim().toLowerCase()==="pending"?null:Number(n.amount),status:String(n.status??"Agreed").trim().toLowerCase(),effective_from:iso(n.effective_from),effective_to:iso(n.effective_to)}});if(mapped.length>500)throw new Error("Maximum 500 rows per rate import file.");setRows(mapped);setFile(f.name)}catch(x:any){setRows([]);setError(x.message||"Unable to read file.")}finally{e.target.value=""}};
 const run=async()=>{if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id){setError("Select active company and business unit.");return}if(!rows.length)return;setBusy(true);setError("");setMessage("");try{const r=await supabase.rpc("transport_import_rate_rows",{p_kind:kind,p_rows:rows});if(r.error)throw r.error;setMessage(`${r.data?.imported??rows.length} rate row(s) imported.`);setRows([]);setFile("")}catch(x:any){setError(x.message||"Import failed. No partial rows are kept from the failed transaction.")}finally{setBusy(false)}};
 return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
  <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-bold">Transport Rate Imports</h2><p className="text-xs text-slate-600">Central import for annual customer rates, supplier rates and customer additional charges. Existing historical periods are never overwritten.</p></div><Upload className="h-5 w-5 text-emerald-700"/></div>
  <div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-xs font-semibold">Import Type<NaviloSearchableSelect nativeCompatibility preserveLabel className="input mt-1 h-9 min-w-52" value={kind} disabled={busy} onChange={e=>{setKind(e.target.value as RateKind);setRows([]);setFile("");setError("");setMessage("")}}>{(Object.keys(defs) as RateKind[]).map(k=><option key={k} value={k}>{defs[k].title}</option>)}</NaviloSearchableSelect></label>
   <button className="btn h-9" onClick={download} disabled={busy}>Download Template</button><button className="btn h-9" onClick={()=>input.current?.click()} disabled={busy}>Choose Excel / CSV</button><input ref={input} className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={choose}/>
   <button className="btn-primary h-9" disabled={busy||!rows.length} onClick={()=>void run()}>{busy?"Importing…":`Import ${rows.length||""} Rows`}</button></div>
  {file&&<p className="mt-2 text-xs text-slate-600">{file} · {rows.length} row(s) ready. Import is atomic: any invalid master, date or overlapping period rejects the file.</p>}
  {error&&<p role="alert" className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}{message&&<p role="status" className="mt-2 rounded bg-emerald-50 p-2 text-xs text-emerald-700">{message}</p>}
  {rows.length>0&&<div className="mt-3 max-h-52 overflow-auto border"><table className="w-full text-left text-[11px]"><thead className="sticky top-0 bg-slate-100"><tr>{Object.keys(rows[0]).map(h=><th key={h} className="p-1">{h.replaceAll("_"," ")}</th>)}</tr></thead><tbody>{rows.slice(0,100).map((r,i)=><tr key={i} className="border-t">{Object.values(r).map((v:any,j)=><td key={j} className="p-1">{v==null?"Pending":String(v)}</td>)}</tr>)}</tbody></table>{rows.length>100&&<p className="p-1 text-xs">Preview shows first 100 rows.</p>}</div>}
 </section>
}


function TransportExpenseImports(){
 const {activeCompany,activeBusinessUnit}=useAuth(); const input=useRef<HTMLInputElement>(null);
 const [rows,setRows]=useState<any[]>([]),[file,setFile]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const headers=["Source Reference","Trip No","Expense Date","Expense Type","Amount","Payment Method","Supplier","Description"];
 const sample=["EXP-0001","TRIP-0001","2026-10-05","Diesel",5000,"Cash","","Diesel expense"];
 const download=()=>{const ws=XLSX.utils.aoa_to_sheet([headers,sample]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Expenses");XLSX.writeFile(wb,"NAVILO-Transport-Trip-Expense-template.xlsx")};
 const choose=async(e:React.ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];if(!f)return;setError("");setMessage("");try{const wb=XLSX.read(await f.arrayBuffer(),{type:"array",cellDates:true});const data=XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]],{defval:""});if(!data.length)throw new Error("File has no data rows.");const mapped=data.map((r:any)=>{const n=Object.fromEntries(Object.entries(r).map(([k,v])=>[key(k),v]));return{source_reference:String(n.source_reference??"").trim(),trip_no:String(n.trip_no??"").trim(),expense_date:iso(n.expense_date),expense_type:String(n.expense_type??"").trim(),amount:Number(n.amount),payment_method:String(n.payment_method??"").trim(),supplier:String(n.supplier??"").trim(),description:String(n.description??"").trim()}});if(mapped.length>500)throw new Error("Maximum 500 expense rows per file.");const seen=new Set<string>();for(const [i,r] of mapped.entries()){const k=r.source_reference.toLowerCase();if(!r.source_reference||!r.trip_no||!r.expense_date||!r.expense_type||!Number.isFinite(r.amount)||r.amount<=0||!/^(cash|bank|payable)$/i.test(r.payment_method))throw new Error(`Row ${i+2}: Source Reference, Trip No, Date, Expense Type, positive Amount and Cash/Bank/Payable are required.`);if(seen.has(k))throw new Error(`Row ${i+2}: duplicate Source Reference in file: ${r.source_reference}`);seen.add(k);if(/^payable$/i.test(r.payment_method)&&!r.supplier)throw new Error(`Row ${i+2}: Supplier is required for Payable expense.`)}setRows(mapped);setFile(f.name)}catch(x:any){setRows([]);setError(x.message||"Unable to read file.")}finally{e.target.value=""}};
 const run=async()=>{if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id){setError("Select active company and business unit.");return}if(!rows.length)return;setBusy(true);setError("");setMessage("");try{const x=await supabase.rpc("transport_post_trip_expense_batch",{p_rows:rows});if(x.error)throw x.error;setMessage(`${x.data?.posted??rows.length} Transport expense row(s) posted atomically to canonical accounting.`);setRows([]);setFile("")}catch(x:any){setError(x.message||"Expense import failed. No rows from this file were posted.")}finally{setBusy(false)}};
 return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-bold">Transport Trip Expense Import</h2><p className="text-xs text-slate-600">Posts Trip expenses through canonical accounting. Payable rows require Supplier; Source Reference prevents duplicate imports.</p></div><Upload className="h-5 w-5 text-emerald-700"/></div><div className="mt-3 flex flex-wrap gap-2"><button className="btn h-9" onClick={download} disabled={busy}>Download Template</button><button className="btn h-9" onClick={()=>input.current?.click()} disabled={busy}>Choose Excel / CSV</button><input ref={input} className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={choose}/><button className="btn-primary h-9" disabled={busy||!rows.length} onClick={()=>void run()}>{busy?"Posting…":`Post ${rows.length||""} Rows`}</button></div>{file&&<p className="mt-2 text-xs text-slate-600">{file} · {rows.length} row(s) ready. The file posts atomically: any invalid row rolls back the whole file. Source Reference also prevents duplicate imports.</p>}{error&&<p role="alert" className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}{message&&<p role="status" className="mt-2 rounded bg-emerald-50 p-2 text-xs text-emerald-700">{message}</p>}{rows.length>0&&<div className="mt-3 max-h-52 overflow-auto border"><table className="w-full text-left text-[11px]"><thead className="sticky top-0 bg-slate-100"><tr>{Object.keys(rows[0]).map(h=><th key={h} className="p-1">{h.replaceAll("_"," ")}</th>)}</tr></thead><tbody>{rows.slice(0,100).map((r,i)=><tr key={i} className="border-t">{Object.values(r).map((v:any,j)=><td key={j} className="p-1">{String(v??"")}</td>)}</tr>)}</tbody></table></div>}</section>
}



function TransportTransferTripImports(){
 const {activeCompany,activeBusinessUnit}=useAuth(); const input=useRef<HTMLInputElement>(null);
 const [rows,setRows]=useState<any[]>([]),[file,setFile]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const headers=["Source Company","Source Trip ID","Trip Date","Customer","Vehicle No","Driver","Driver Code","Truck Type","From Location","To Location","Job No","Sale Type","Notes"];
 const sample=["Parent NAVILO","TRIP-SOURCE-0001","2026-10-05","Customer A","ABC-123","Driver A","DRV-001","Flatbed","Origin","Destination","JOB-001","Credit","Imported from NAVILO"];
 const download=()=>{const ws=XLSX.utils.aoa_to_sheet([headers,sample]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Trips");XLSX.writeFile(wb,"NAVILO-Transport-Transfer-Trips-template.xlsx")};
 const exportCurrent=async()=>{setBusy(true);setError("");setMessage("");try{const all:any[]=[];let offset=0,total=0;do{const x=await supabase.rpc("transport_transfer_export_page",{p_limit:500,p_offset:offset});if(x.error)throw x.error;const page=Array.isArray(x.data?.rows)?x.data.rows:[];total=Number(x.data?.total_count??page.length);all.push(...page);offset+=page.length;if(!page.length)break;}while(all.length<total);const out=all.map((r:any)=>[r.source_company,r.source_trip_id,r.trip_date,r.customer??"",r.vehicle_no??"",r.driver??"",r.driver_code??"",r.truck_type??"",r.from_location??"",r.to_location??"",r.job_no??"",r.sale_type??"",r.notes??""]);const ws=XLSX.utils.aoa_to_sheet([headers,...out]);ws["!cols"]=headers.map(h=>({wch:Math.min(28,Math.max(12,h.length+3))}));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Trips");XLSX.writeFile(wb,"NAVILO-Transport-Transfer.xlsx");setMessage(`${all.length} Trip(s) exported for NAVILO transfer.`)}catch(x:any){setError(x.message||"Transfer export failed.")}finally{setBusy(false)}};
 const choose=async(e:React.ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];if(!f)return;setError("");setMessage("");try{const wb=XLSX.read(await f.arrayBuffer(),{type:"array",cellDates:true});const data=XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]],{defval:""});if(!data.length)throw new Error("File has no data rows.");if(data.length>500)throw new Error("Maximum 500 Trip rows per transfer file.");const mapped=data.map((r:any)=>{const n=Object.fromEntries(Object.entries(r).map(([k,v])=>[key(k),v]));return{source_company:String(n.source_company??"").trim(),source_trip_id:String(n.source_trip_id??"").trim(),trip_date:iso(n.trip_date),customer:String(n.customer??"").trim(),vehicle_no:String(n.vehicle_no??"").trim(),driver:String(n.driver??"").trim(),driver_code:String(n.driver_code??"").trim(),truck_type:String(n.truck_type??"").trim(),from_location:String(n.from_location??"").trim(),to_location:String(n.to_location??"").trim(),po_do_job_no:String(n.job_no??"").trim()||null,sale_type:String(n.sale_type??"").trim()||null,notes:String(n.notes??"").trim()||null}});const seen=new Set<string>();for(const [i,r] of mapped.entries()){const k=(r.source_company+"|"+r.source_trip_id).toLowerCase();if(!r.source_company||!r.source_trip_id||!r.trip_date||!r.customer||!r.from_location||!r.to_location)throw new Error(`Row ${i+2}: Source Company, Source Trip ID, Trip Date, Customer ID, From and To are required.`);if(seen.has(k))throw new Error(`Row ${i+2}: duplicate Source Company + Source Trip ID.`);seen.add(k)}
 const preview=await Promise.all(mapped.map(async(r:any)=>{const m=await supabase.rpc("transport_resolve_transfer_masters",{p_customer:r.customer,p_vehicle_no:r.vehicle_no||null,p_driver_code:r.driver_code||null,p_driver_name:r.driver||null,p_truck_type:r.truck_type||null,p_from_location:r.from_location,p_to_location:r.to_location});if(m.error||m.data?.status!=="Resolved")return{...r,import_status:"Error",import_reason:m.error?.message??"One or more target-company masters could not be resolved."};const z={...r,customer_id:m.data.customer_id,vehicle_id:m.data.vehicle_id,driver_id:m.data.driver_id,truck_type_id:m.data.truck_type_id,from_location_id:m.data.from_location_id,to_location_id:m.data.to_location_id};const x=await supabase.rpc("transport_classify_source_trip",{p_source_company:z.source_company,p_source_trip_id:z.source_trip_id,p_trip_date:z.trip_date,p_customer_id:z.customer_id,p_vehicle_id:z.vehicle_id,p_driver_id:z.driver_id,p_from_location_id:z.from_location_id,p_to_location_id:z.to_location_id,p_po_do_job_no:z.po_do_job_no});return{...z,import_status:x.error?"Error":x.data?.status??"Error",import_reason:x.error?.message??x.data?.reason??""}}));setRows(preview);setFile(f.name)}catch(x:any){setRows([]);setError(x.message||"Unable to read transfer file.")}finally{e.target.value=""}};
 const run=async()=>{if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id){setError("Select active company and business unit.");return}if(!rows.length||rows.some((r:any)=>r.import_status==="Error"))return;setBusy(true);setError("");setMessage("");try{const newRows=rows.filter((r:any)=>r.import_status==="New").map(({import_status,import_reason,customer,vehicle_no,driver,driver_code,truck_type,from_location_id,to_location_id,...r}:any)=>r);if(newRows.length){const x=await supabase.rpc("transport_create_source_trips",{p_request_id:crypto.randomUUID(),p_rows:newRows});if(x.error)throw x.error}for(const r of rows.filter((x:any)=>x.import_status==="Update")){const changes:any={trip_date:r.trip_date,customer_id:r.customer_id,truck_type_id:r.truck_type_id,from_location:r.from_location,to_location:r.to_location,from_location_id:r.from_location_id,to_location_id:r.to_location_id,po_do_job_no:r.po_do_job_no,sale_type:r.sale_type,notes:r.notes};const x=await supabase.rpc("transport_apply_source_trip_update",{p_source_company:r.source_company,p_source_trip_id:r.source_trip_id,p_changes:changes,p_vehicle_id:r.vehicle_id,p_driver_id:r.driver_id});if(x.error)throw x.error}setMessage(`Transfer complete: ${newRows.length} New, ${rows.filter((r:any)=>r.import_status==="Update").length} Updated, ${rows.filter((r:any)=>r.import_status==="Duplicate").length} Duplicate skipped.`);setRows([]);setFile("")}catch(x:any){setError(x.message||"Transfer import failed.")}finally{setBusy(false)}};
 return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-bold">NAVILO → NAVILO Transport Transfer</h2><p className="text-xs text-slate-600">Stable Source Company + Source Trip ID prevents duplicate Trips. Preview classifies New / Update / Duplicate / Error before import.</p></div><Truck className="h-5 w-5 text-emerald-700"/></div><div className="mt-3 flex flex-wrap gap-2"><button className="btn h-9" onClick={download} disabled={busy}>Download Transfer Template</button><button className="btn h-9" onClick={()=>void exportCurrent()} disabled={busy}>Export Current NAVILO Trips</button><button className="btn h-9" onClick={()=>input.current?.click()} disabled={busy}>Choose Excel / CSV</button><input ref={input} className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={choose}/><button className="btn-primary h-9" disabled={busy||!rows.length||rows.some((r:any)=>r.import_status==="Error")} onClick={()=>void run()}>{busy?"Importing…":"Import Transfer"}</button></div>{file&&<p className="mt-2 text-xs text-slate-600">{file} · New {rows.filter((r:any)=>r.import_status==="New").length} · Update {rows.filter((r:any)=>r.import_status==="Update").length} · Duplicate {rows.filter((r:any)=>r.import_status==="Duplicate").length} · Error {rows.filter((r:any)=>r.import_status==="Error").length}</p>}{error&&<p role="alert" className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}{message&&<p role="status" className="mt-2 rounded bg-emerald-50 p-2 text-xs text-emerald-700">{message}</p>}</section>
}

function TransportDriverPayImports(){
 const {activeCompany,activeBusinessUnit}=useAuth(); const input=useRef<HTMLInputElement>(null);
 const [rows,setRows]=useState<any[]>([]),[file,setFile]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const headers=["Trip ID","Driver Pay","Reason"]; const sample=["00000000-0000-0000-0000-000000000000",1000,"Agreed driver pay"];
 const download=()=>{const ws=XLSX.utils.aoa_to_sheet([headers,sample]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Driver Pay");XLSX.writeFile(wb,"NAVILO-Transport-Driver-Pay-template.xlsx")};
 const choose=async(e:React.ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];if(!f)return;setError("");setMessage("");try{const wb=XLSX.read(await f.arrayBuffer(),{type:"array"});const data=XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]],{defval:""});if(!data.length)throw new Error("File has no data rows.");const mapped=data.map((r:any)=>{const n=Object.fromEntries(Object.entries(r).map(([k,v])=>[key(k),v]));return{trip_id:String(n.trip_id??"").trim(),amount:Number(n.driver_pay),reason:String(n.reason??"").trim()}});if(mapped.length>500)throw new Error("Maximum 500 Driver Pay rows per file.");const seen=new Set<string>();for(const [i,r] of mapped.entries()){const k=r.trip_id.toLowerCase();if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.trip_id)||!Number.isFinite(r.amount)||r.amount<0||Math.round(r.amount*100)!==r.amount*100||!r.reason)throw new Error(`Row ${i+2}: valid Trip ID, non-negative two-decimal Driver Pay and Reason are required.`);if(seen.has(k))throw new Error(`Row ${i+2}: duplicate Trip ID in file.`);seen.add(k)}setRows(mapped);setFile(f.name)}catch(x:any){setRows([]);setError(x.message||"Unable to read file.")}finally{e.target.value=""}};
 const run=async()=>{if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id){setError("Select active company and business unit.");return}if(!rows.length)return;setBusy(true);setError("");setMessage("");try{const requestId=crypto.randomUUID();const x=await supabase.rpc("transport_driver_charge_upload",{p_request_id:requestId,p_rows:rows});if(x.error)throw x.error;setMessage(`${x.data?.saved??rows.length} Driver Pay row(s) saved through the existing Driver Hisaab engine.`);setRows([]);setFile("")}catch(x:any){setError(x.message||"Driver Pay import failed. No partial rows are kept from the failed transaction.")}finally{setBusy(false)}};
 return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-bold">Transport Driver Pay Import</h2><p className="text-xs text-slate-600">Updates agreed Driver Pay through the existing Driver Hisaab engine. Settled/attributed obligations remain immutable.</p></div><Upload className="h-5 w-5 text-emerald-700"/></div><div className="mt-3 flex flex-wrap gap-2"><button className="btn h-9" onClick={download} disabled={busy}>Download Template</button><button className="btn h-9" onClick={()=>input.current?.click()} disabled={busy}>Choose Excel / CSV</button><input ref={input} className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={choose}/><button className="btn-primary h-9" disabled={busy||!rows.length} onClick={()=>void run()}>{busy?"Saving…":`Import ${rows.length||""} Rows`}</button></div>{file&&<p className="mt-2 text-xs text-slate-600">{file} · {rows.length} row(s) ready. Existing server idempotency and immutable attribution rules remain enforced.</p>}{error&&<p role="alert" className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}{message&&<p role="status" className="mt-2 rounded bg-emerald-50 p-2 text-xs text-emerald-700">{message}</p>}{rows.length>0&&<div className="mt-3 max-h-52 overflow-auto border"><table className="w-full text-left text-[11px]"><thead className="sticky top-0 bg-slate-100"><tr>{Object.keys(rows[0]).map(h=><th key={h} className="p-1">{h.replaceAll("_"," ")}</th>)}</tr></thead><tbody>{rows.slice(0,100).map((r,i)=><tr key={i} className="border-t">{Object.values(r).map((v:any,j)=><td key={j} className="p-1">{String(v??"")}</td>)}</tr>)}</tbody></table></div>}</section>
}


function TransportSettlementImports(){
 const {activeCompany,activeBusinessUnit}=useAuth(); const input=useRef<HTMLInputElement>(null);
 const [rows,setRows]=useState<any[]>([]),[file,setFile]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const headers=["Source Reference","Side","Payment Date","Party","Document No","Amount","Account","Method"]; const sample=["RCPT-0001","Customer","2026-10-05","Customer A","INV-1001",10000,"Bank","Bank"];
 const download=()=>{const ws=XLSX.utils.aoa_to_sheet([headers,sample]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Settlements");XLSX.writeFile(wb,"NAVILO-Transport-Receipts-Payments-template.xlsx")};
 const choose=async(e:React.ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];if(!f)return;setError("");setMessage("");try{const wb=XLSX.read(await f.arrayBuffer(),{type:"array",cellDates:true});const data=XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]],{defval:""});if(!data.length)throw new Error("File has no data rows.");const mapped=data.map((r:any)=>{const n=Object.fromEntries(Object.entries(r).map(([k,v])=>[key(k),v]));return{source_reference:String(n.source_reference??"").trim(),side:String(n.side??"").trim().toLowerCase(),payment_date:iso(n.payment_date),party:String(n.party??"").trim(),document_no:String(n.document_no??"").trim(),amount:Number(n.amount),account:String(n.account??"").trim(),method:String(n.method??"Bank").trim()}});if(mapped.length>500)throw new Error("Maximum 500 settlement rows per file.");const seen=new Set<string>();for(const [i,r] of mapped.entries()){const k=r.source_reference.toLowerCase();if(!r.source_reference||!/^(customer|supplier)$/.test(r.side)||!r.payment_date||!r.party||!r.document_no||!Number.isFinite(r.amount)||r.amount<=0||!r.account)throw new Error(`Row ${i+2}: Source Reference, Customer/Supplier Side, Date, Party, Document No, positive Amount and Account are required.`);if(seen.has(k))throw new Error(`Row ${i+2}: duplicate Source Reference in file.`);seen.add(k)}setRows(mapped);setFile(f.name)}catch(x:any){setRows([]);setError(x.message||"Unable to read file.")}finally{e.target.value=""}};
 const run=async()=>{if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id){setError("Select active company and business unit.");return}if(!rows.length)return;setBusy(true);setError("");setMessage("");try{const x=await supabase.rpc("transport_import_settlements_batch",{p_rows:rows});if(x.error)throw x.error;setMessage(`${x.data?.posted??rows.length} receipt/payment row(s) posted atomically through canonical settlement accounting.`);setRows([]);setFile("")}catch(x:any){setError(x.message||"Settlement import failed. No partial rows are kept from the failed transaction.")}finally{setBusy(false)}};
 return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-bold">Transport Receipts / Payments Import</h2><p className="text-xs text-slate-600">Customer receipts and supplier payments post through canonical settlement accounting. Partial allocations are supported; overpayment is blocked.</p></div><Landmark className="h-5 w-5 text-emerald-700"/></div><div className="mt-3 flex flex-wrap gap-2"><button className="btn h-9" onClick={download} disabled={busy}>Download Template</button><button className="btn h-9" onClick={()=>input.current?.click()} disabled={busy}>Choose Excel / CSV</button><input ref={input} className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={choose}/><button className="btn-primary h-9" disabled={busy||!rows.length} onClick={()=>void run()}>{busy?"Posting…":`Post ${rows.length||""} Rows`}</button></div>{file&&<p className="mt-2 text-xs text-slate-600">{file} · {rows.length} row(s) ready. Any invalid row rolls back the whole file.</p>}{error&&<p role="alert" className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}{message&&<p role="status" className="mt-2 rounded bg-emerald-50 p-2 text-xs text-emerald-700">{message}</p>}{rows.length>0&&<div className="mt-3 max-h-52 overflow-auto border"><table className="w-full text-left text-[11px]"><thead className="sticky top-0 bg-slate-100"><tr>{Object.keys(rows[0]).map(h=><th key={h} className="p-1">{h.replaceAll("_"," ")}</th>)}</tr></thead><tbody>{rows.slice(0,100).map((r,i)=><tr key={i} className="border-t">{Object.values(r).map((v:any,j)=><td key={j} className="p-1">{String(v??"")}</td>)}</tr>)}</tbody></table></div>}</section>
}

function TransportInvoiceImports(){
 const {activeCompany,activeBusinessUnit}=useAuth(); const input=useRef<HTMLInputElement>(null);
 const [rows,setRows]=useState<any[]>([]),[file,setFile]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
 const headers=["Source Company","Source Invoice ID","Invoice No","Invoice Date","Customer","Trip No","Vehicle No","Amount","VAT","Description"];
 const sample=["AMK Steels","AMK-INV-1001","INV-1001","2026-10-05","Customer A","TRIP-0001","ABC-123",25000,"No","Transport service"];
 const download=()=>{const ws=XLSX.utils.aoa_to_sheet([headers,sample]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Invoices");XLSX.writeFile(wb,"NAVILO-Transport-Sales-Invoice-template.xlsx")};
 const choose=async(e:React.ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];if(!f)return;setError("");setMessage("");try{const wb=XLSX.read(await f.arrayBuffer(),{type:"array",cellDates:true});const data=XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]],{defval:""});if(!data.length)throw new Error("File has no data rows.");const mapped=data.map((r:any)=>{const n=Object.fromEntries(Object.entries(r).map(([k,v])=>[key(k),v]));return{source_company:String(n.source_company??"").trim(),source_invoice_id:String(n.source_invoice_id??"").trim(),invoice_no:String(n.invoice_no??"").trim(),invoice_date:iso(n.invoice_date),customer:String(n.customer??"").trim(),trip_no:String(n.trip_no??"").trim(),vehicle_no:String(n.vehicle_no??"").trim(),amount:Number(n.amount),vat:/^(yes|y|true|1|tax)$/i.test(String(n.vat??"").trim()),description:String(n.description??"").trim()}});if(mapped.length>500)throw new Error("Maximum 500 invoice rows per file.");for(const [i,r] of mapped.entries()){if(!r.source_company||!r.source_invoice_id||!r.invoice_no||!r.invoice_date||!r.customer||!r.trip_no||!r.vehicle_no||!Number.isFinite(r.amount)||r.amount<=0)throw new Error(`Row ${i+2}: Source Company, Source Invoice ID, Invoice No, Date, Customer, Trip No, Vehicle No and positive Amount are required.`)}const preview=await supabase.rpc("transport_preview_customer_invoice_batch",{p_rows:mapped});if(preview.error)throw preview.error;setRows(preview.data?.rows??mapped);setFile(f.name)}catch(x:any){setRows([]);setError(x.message||"Unable to read file.")}finally{e.target.value=""}};
 const run=async()=>{if(!activeCompany?.company_id||!activeBusinessUnit?.business_unit_id){setError("Select active company and business unit.");return}if(!rows.length)return;const blocked=rows.filter((r:any)=>r.import_status!=="New");if(blocked.length){setError(`Import blocked: ${blocked.length} row(s) are Duplicate/Error. Resolve them before importing.`);return}setBusy(true);setError("");setMessage("");try{const x=await supabase.rpc("transport_import_customer_invoice_batch",{p_rows:rows.map(({import_status,import_reason,...r}:any)=>r)});if(x.error)throw x.error;setMessage(`${x.data?.invoices??0} draft Sales Invoice(s), ${x.data?.trip_rows??rows.length} Trip row(s) imported atomically. Review them in Sales before posting.`);setRows([]);setFile("")}catch(x:any){setError(x.message||"Invoice import failed. No rows from this file were imported.")}finally{setBusy(false)}};
 return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-bold">Transport Sales Invoice Import</h2><p className="text-xs text-slate-600">Creates canonical draft Sales service invoices. Source Company + Source Invoice ID provide durable duplicate protection; Trip No and Vehicle No must match. Upload does not post AR/VAT.</p></div><FileText className="h-5 w-5 text-emerald-700"/></div>
 <div className="mt-3 flex flex-wrap gap-2"><button className="btn h-9" onClick={download} disabled={busy}>Download Template</button><button className="btn h-9" onClick={()=>input.current?.click()} disabled={busy}>Choose Excel / CSV</button><input ref={input} className="hidden" type="file" accept=".xlsx,.xls,.csv" onChange={choose}/><button className="btn-primary h-9" disabled={busy||!rows.length} onClick={()=>void run()}>{busy?"Importing…":`Import ${rows.length||""} Rows`}</button></div>
 {file&&<p className="mt-2 text-xs text-slate-600">{file} · {rows.length} row(s) checked · New {rows.filter((r:any)=>r.import_status==="New").length} · Duplicate {rows.filter((r:any)=>r.import_status==="Duplicate").length} · Error {rows.filter((r:any)=>r.import_status==="Error").length}. Import is enabled only when every row is New.</p>}{error&&<p role="alert" className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{error}</p>}{message&&<p role="status" className="mt-2 rounded bg-emerald-50 p-2 text-xs text-emerald-700">{message}</p>}
 {rows.length>0&&<div className="mt-3 max-h-52 overflow-auto border"><table className="w-full text-left text-[11px]"><thead className="sticky top-0 bg-slate-100"><tr>{Object.keys(rows[0]).map(h=><th key={h} className="p-1">{h.replaceAll("_"," ")}</th>)}</tr></thead><tbody>{rows.slice(0,100).map((r,i)=><tr key={i} className="border-t">{Object.values(r).map((v:any,j)=><td key={j} className="p-1">{typeof v==="boolean"?(v?"Yes":"No"):String(v??"")}</td>)}</tr>)}</tbody></table></div>}</section>
}

export default function ImportCenter() {
  const { activeCompany, activeBusinessUnit, isPlatformOwner } = useAuth();
  const role = activeBusinessUnit?.membership_role ?? activeCompany?.membership_role;
  const permissions = activeBusinessUnit?.permissions ?? activeCompany?.permissions;
  const canImport = (module: ModuleKey) => (activeCompany?.enabled_modules?.includes(module) ?? true) && (activeBusinessUnit?.enabled_modules.includes(module) ?? true) && (isPlatformOwner || hasPermission(role, module, "create", permissions, false));
  const cards = [
    { title: "Receipts / Payments", detail: "Transport settlement Excel import is available above and posts through canonical accounting.", icon: Landmark, destinations: [] },
    { title: "Customers", detail: "Use the customer Excel/CSV template.", icon: Users, destinations: canImport("master") ? [{ label: "Open customer import", to: "/master-data/customers" }] : [] },
    { title: "Suppliers", detail: "Use the supplier Excel/CSV template.", icon: Truck, destinations: canImport("master") ? [{ label: "Open supplier import", to: "/master-data/suppliers" }] : [] },
    { title: "Invoices", detail: "Transport invoice Excel import is available above; review/post canonical drafts in Sales.", icon: FileText, destinations: [...(canImport("sales") ? [{ label: "Sales", to: "/sales" }] : []),...(canImport("purchase") ? [{ label: "Purchase", to: "/purchase" }] : [])] },
  ];
  return <div className="mx-auto max-w-6xl space-y-5 py-3"><div><h1 className="text-xl font-bold text-slate-900">Import Center</h1><p className="mt-1 text-sm text-slate-600">Choose a data type, download its template and review records before posting.</p></div>
   {canImport("transport")&&<><TransportTransferTripImports/><TransportMasterImports/><TransportRateImports/>{<TransportDriverPayImports/>}{canImport("accounting")&&<TransportExpenseImports/>}{canImport("accounting")&&<TransportSettlementImports/>}{canImport("sales")&&<TransportInvoiceImports/>}</>}
   <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(card=>{if(card.title==="Customers")return <CustomerMasterImportCard key={card.title} canImport={canImport("master")}/>;const Icon=card.icon;return <section key={card.title} className="flex min-h-52 flex-col items-center rounded-xl border border-slate-200 bg-white px-5 py-6 text-center shadow-sm"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Icon className="h-6 w-6"/></div><h2 className="mt-4 text-sm font-bold text-slate-900">{card.title}</h2><p className="mt-1 min-h-10 text-xs leading-5 text-slate-600">{card.detail}</p>{card.destinations.length?<div className="mt-auto flex flex-wrap justify-center gap-2 pt-3">{card.destinations.map(d=><Link key={d.to} to={d.to} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-800">{d.label}<ArrowRight className="h-3.5 w-3.5"/></Link>)}</div>:<span className="mt-auto pt-3 text-xs font-medium text-slate-500">{card.title==="Receipts / Payments"&&canImport("transport")&&canImport("accounting")?"Use Transport Receipts / Payments Import above":card.title==="Bank Data"?"Not available":"No import permission"}</span>}</section>})}</div></div>;
}