import SearchableSelect from "@/components/SearchableSelect";
import { useEffect, useMemo, useState } from "react";
import { Search, Package, Warehouse as WarehouseIcon, RefreshCw, SlidersHorizontal, X, Save, FileSpreadsheet, Printer, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";

type Item={id:string;sku:string;name:string;name_urdu:string|null;grade:string|null;size:string|null;unit:string|null};
type Warehouse={id:string;name:string;name_urdu:string|null;location:string|null};
type Godown={id:string;name:string;name_urdu:string|null;location:string|null;warehouse_id:string};
type Employee={id:string;employee_code:string|null;name:string;name_urdu:string|null;designation:string|null};
type StockRow={id:string;user_id:string;item_id:string|null;warehouse_id:string|null;godown_id:string|null;godown:string;quantity:number;updated_at:string;item:Item|null};
type AdjustmentAction="add"|"remove";
type AdjustmentForm={item_id:string;warehouse_id:string;godown_id:string;action:AdjustmentAction;qty:string;reason_code:string;reference:string;approved_by_employee_id:string;remarks:string};

const EMPTY_FORM:AdjustmentForm={item_id:"",warehouse_id:"",godown_id:"",action:"remove",qty:"",reason_code:"",reference:"",approved_by_employee_id:"",remarks:""};
const REASONS=[
 ["physical_count_difference","Physical Count Difference"],
 ["shortage","Shortage"],
 ["excess_found","Excess Found"],
 ["damage","Damage"],
 ["breakage","Breakage"],
 ["scrap_wastage","Scrap / Wastage"],
 ["weight_difference","Weight Difference"],
 ["loading_unloading_difference","Loading / Unloading Difference"],
 ["wrong_entry_correction","Wrong Previous Entry Correction"],
 ["opening_stock_correction","Opening Stock Correction"],
 ["other","Other"],
] as const;
const clean=(v:unknown)=>String(v??"").trim();
const bilingual=(en:string,ur?:string|null)=>ur?.trim()?`${en} / ${ur.trim()}`:en;
const qtyText=(qty:number,unit?:string|null)=>`${Number(qty||0).toLocaleString(undefined,{maximumFractionDigits:3})} ${clean(unit)||"UOM"}`;
const errText=(x:unknown)=>typeof x==="object"&&x!==null&&"message" in x?String((x as {message?:unknown}).message||"Unknown error"):x instanceof Error?x.message:String(x||"Unknown error");

export default function WarehouseStock(){
 const[items,setItems]=useState<Item[]>([]),[warehouses,setWarehouses]=useState<Warehouse[]>([]),[godowns,setGodowns]=useState<Godown[]>([]),[employees,setEmployees]=useState<Employee[]>([]),[stock,setStock]=useState<StockRow[]>([]);
 const[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[search,setSearch]=useState(""),[warehouseFilter,setWarehouseFilter]=useState("all"),[godownFilter,setGodownFilter]=useState("all"),[itemFilter,setItemFilter]=useState("all"),[modalOpen,setModalOpen]=useState(false),[form,setForm]=useState<AdjustmentForm>(EMPTY_FORM),[slipFile,setSlipFile]=useState<File|null>(null);
 const[message,setMessage]=useState<{type:"success"|"error";text:string}|null>(null);
 const notify=(type:"success"|"error",text:string)=>{setMessage({type,text});window.setTimeout(()=>setMessage(null),5500)};

 const fetchData=async()=>{setLoading(true);const[itemsRes,warehousesRes,godownsRes,employeesRes,stockRes]=await Promise.all([
  supabase.from("items").select("id,sku,name,name_urdu,grade,size,unit").order("name"),
  supabase.from("warehouses").select("id,name,name_urdu,location").order("name"),
  supabase.from("godowns").select("id,name,name_urdu,location,warehouse_id").order("name"),
  supabase.from("employees").select("id,employee_code,name,name_urdu,designation").eq("is_active",true).order("name"),
  supabase.from("warehouse_stock").select("id,user_id,item_id,warehouse_id,godown_id,godown,quantity,updated_at").order("updated_at",{ascending:false})]);
  if(itemsRes.error)notify("error",`Items load failed: ${itemsRes.error.message}`); else setItems((itemsRes.data??[]) as Item[]);
  if(warehousesRes.error)notify("error",`Warehouses load failed: ${warehousesRes.error.message}`); else setWarehouses((warehousesRes.data??[]) as Warehouse[]);
  if(godownsRes.error)notify("error",`Godowns load failed: ${godownsRes.error.message}`); else setGodowns((godownsRes.data??[]) as Godown[]);
  if(employeesRes.error)notify("error",`Approvers load failed: ${employeesRes.error.message}`); else setEmployees((employeesRes.data??[]) as Employee[]);
  if(stockRes.error){notify("error",`Stock load failed: ${stockRes.error.message}`);setStock([])}else{const itemMap=new Map((itemsRes.data??[]).map((i:any)=>[i.id,i]));setStock(((stockRes.data??[]) as any[]).map(r=>({...r,item:itemMap.get(r.item_id)??null})) as StockRow[])}
  setLoading(false)};
 useEffect(()=>{void fetchData()},[]);

 const filteredGodownsForFilter=useMemo(()=>warehouseFilter==="all"?godowns:godowns.filter(g=>g.warehouse_id===warehouseFilter),[godowns,warehouseFilter]);
 const modalGodowns=useMemo(()=>form.warehouse_id?godowns.filter(g=>g.warehouse_id===form.warehouse_id):[],[godowns,form.warehouse_id]);
 const warehouse=(id:string|null)=>warehouses.find(w=>w.id===id);const godown=(id:string|null)=>godowns.find(g=>g.id===id);
 const warehouseName=(id:string|null)=>{const w=warehouse(id);return w?bilingual(w.name,w.name_urdu):"—"};
 const godownName=(id:string|null,fallback?:string)=>{const g=godown(id);return g?bilingual(g.name,g.name_urdu):(fallback??"—")};
 const filteredStock=useMemo(()=>{const q=search.trim().toLowerCase();return stock.filter(row=>{const item=row.item;const searchable=`${item?.sku??""} ${item?.name??""} ${item?.name_urdu??""} ${item?.grade??""} ${item?.size??""} ${item?.unit??""} ${warehouseName(row.warehouse_id)} ${godownName(row.godown_id,row.godown)}`.toLowerCase();return(!q||searchable.includes(q))&&(warehouseFilter==="all"||row.warehouse_id===warehouseFilter)&&(godownFilter==="all"||row.godown_id===godownFilter)&&(itemFilter==="all"||row.item_id===itemFilter)})},[stock,search,warehouseFilter,godownFilter,itemFilter,warehouses,godowns]);
 const totalPositiveItems=useMemo(()=>filteredStock.filter(r=>Number(r.quantity)>0).length,[filteredStock]);
 const quantitySummary=useMemo(()=>{const units=new Set(filteredStock.map(r=>clean(r.item?.unit)||"UOM"));if(!filteredStock.length)return"0";if(units.size!==1)return"Mixed UOM";const unit=[...units][0];return qtyText(filteredStock.reduce((s,r)=>s+Number(r.quantity||0),0),unit)},[filteredStock]);
 const currentStock=useMemo(()=>Number(stock.find(r=>r.item_id===form.item_id&&r.warehouse_id===form.warehouse_id&&r.godown_id===form.godown_id)?.quantity??0),[stock,form.item_id,form.warehouse_id,form.godown_id]);
 const selectedItem=items.find(i=>i.id===form.item_id);const uom=clean(selectedItem?.unit)||"UOM";
 const adjustmentQty=Number(form.qty||0);const resultingStock=form.action==="add"?currentStock+adjustmentQty:currentStock-adjustmentQty;

 const openAdjustment=()=>{const warehouseId=warehouses[0]?.id??"";const firstGodown=godowns.find(g=>g.warehouse_id===warehouseId)?.id??"";setSlipFile(null);setForm({...EMPTY_FORM,warehouse_id:warehouseId,godown_id:firstGodown});setModalOpen(true)};
 const closeModal=()=>{if(saving)return;setModalOpen(false);setSlipFile(null);setForm(EMPTY_FORM)};
 const saveAdjustment=async(e:React.FormEvent<HTMLFormElement>)=>{e.preventDefault();setMessage(null);
  if(!form.item_id)return notify("error","Select an item.");
  if(!form.warehouse_id)return notify("error","Select a warehouse.");
  if(!form.godown_id)return notify("error","Select a godown.");
  if(!form.reason_code)return notify("error","Select a reason.");
  if(!form.reference.trim())return notify("error","Reference / approval document number is required.");
  if(!form.approved_by_employee_id)return notify("error","Approved By is required.");
  if(!slipFile)return notify("error","Approved stock adjustment slip upload is required.");
  if(slipFile.size>5*1024*1024)return notify("error","Approval slip must be 5 MB or smaller.");
  if(!["application/pdf","image/png","image/jpeg","image/webp"].includes(slipFile.type))return notify("error","Upload PDF, PNG, JPG or WEBP approval slip only.");
  if(form.reason_code==="other"&&!form.remarks.trim())return notify("error","Remarks are required for Other reason.");
  if(!Number.isFinite(adjustmentQty)||adjustmentQty<=0)return notify("error","Adjustment quantity must be greater than zero.");
  if(form.action==="remove"&&adjustmentQty>currentStock)return notify("error",`Cannot remove ${qtyText(adjustmentQty,uom)}. Available stock is ${qtyText(currentStock,uom)}.`);
  const selectedGodown=godowns.find(g=>g.id===form.godown_id);if(!selectedGodown||selectedGodown.warehouse_id!==form.warehouse_id)return notify("error","Selected godown does not belong to selected warehouse.");
  setSaving(true);let uploadedPath="";try{
   const{data:companyId,error:companyError}=await supabase.rpc("current_company_id");if(companyError||!companyId)throw new Error(companyError?.message||"Active company could not be resolved.");
   const{data:{user}}=await supabase.auth.getUser();if(!user)throw new Error("Authentication required.");
   const ext=(slipFile.name.split(".").pop()||"file").toLowerCase().replace(/[^a-z0-9]/g,"");uploadedPath=`${companyId}/${user.id}/${Date.now()}-${crypto.randomUUID()}.${ext||"file"}`;
   const{error:uploadError}=await supabase.storage.from("stock-adjustment-approvals").upload(uploadedPath,slipFile,{upsert:false,contentType:slipFile.type});if(uploadError)throw uploadError;
   const{data,error}=await supabase.rpc("manual_stock_adjustment",{p_item_id:form.item_id,p_warehouse_id:form.warehouse_id,p_godown_id:form.godown_id,p_action:form.action,p_qty:Number(adjustmentQty.toFixed(3)),p_reason_code:form.reason_code,p_reference:form.reference.trim(),p_approved_by_employee_id:form.approved_by_employee_id,p_approval_slip_path:uploadedPath,p_remarks:form.remarks.trim()||null});if(error)throw error;
   notify("success",`Adjustment saved. Stock ${qtyText(currentStock,uom)} → ${qtyText(Number(data??resultingStock),uom)}.`);setModalOpen(false);setSlipFile(null);setForm(EMPTY_FORM);await fetchData();
  }catch(x){if(uploadedPath)await supabase.storage.from("stock-adjustment-approvals").remove([uploadedPath]);notify("error",`Stock update failed: ${errText(x)}`)}finally{setSaving(false)}};

 const exportExcel=()=>{if(!filteredStock.length)return notify("error","No stock to export.");const rows=filteredStock.map(r=>({Warehouse:warehouseName(r.warehouse_id),Godown:godownName(r.godown_id,r.godown),SKU:r.item?.sku??"Unknown","Item Name":r.item?bilingual(r.item.name,r.item.name_urdu):"Unknown Item",Grade:r.item?.grade??"",Size:r.item?.size??"","Quantity / UOM":qtyText(Number(r.quantity||0),r.item?.unit),Quantity:Number(r.quantity??0),UOM:r.item?.unit??"","Last Updated":r.updated_at}));const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Warehouse Stock");XLSX.writeFile(wb,"warehouse_stock.xlsx")};
 const printPdf=()=>window.print();

 return <div className="space-y-5">
  {message&&<div className={`fixed right-5 top-5 z-[100] max-w-lg rounded-xl border px-4 py-3 text-sm font-medium shadow-xl ${message.type==="success"?"border-emerald-200 bg-emerald-50 text-emerald-800":"border-rose-200 bg-rose-50 text-rose-800"}`}>{message.text}</div>}
  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div className="flex items-start gap-3"><div className="rounded-xl bg-slate-100 p-3"><Package className="h-6 w-6 text-slate-700"/></div><div><h1 className="text-xl font-bold text-slate-900">Warehouse Stock</h1><p className="mt-1 text-sm text-slate-500">Purchase, Sales, Returns, Production and Transfers create source stock movements. Manual changes require controlled adjustment.</p></div></div><button type="button" onClick={openAdjustment} className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-bold text-white"><SlidersHorizontal className="h-4 w-4"/>Stock Adjustment</button></div>
  <div className="grid grid-cols-1 gap-4 md:grid-cols-3"><div className="rounded-2xl border bg-white p-4"><p className="text-xs font-semibold uppercase text-slate-400">Stock Records</p><p className="mt-1 text-2xl font-bold">{filteredStock.length}</p></div><div className="rounded-2xl border bg-white p-4"><p className="text-xs font-semibold uppercase text-slate-400">Positive Stock</p><p className="mt-1 text-2xl font-bold">{totalPositiveItems}</p></div><div className="rounded-2xl border bg-white p-4"><p className="text-xs font-semibold uppercase text-slate-400">Total Quantity / UOM</p><p className="mt-1 text-2xl font-bold">{quantitySummary}</p></div></div>
  <div className="rounded-2xl border bg-white p-4"><div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4"><div className="flex items-center gap-2 rounded-xl border bg-slate-50 px-3 py-2.5"><Search className="h-4 w-4 text-slate-400"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search item, SKU..." className="w-full bg-transparent text-sm outline-none"/></div><SearchableSelect value={warehouseFilter} onChange={e=>{setWarehouseFilter(e.target.value);setGodownFilter("all")}} className="rounded-xl border px-3 py-2.5"><option value="all">All Warehouses</option>{warehouses.map(w=><option key={w.id} value={w.id}>{bilingual(w.name,w.name_urdu)}</option>)}</SearchableSelect><SearchableSelect value={godownFilter} onChange={e=>setGodownFilter(e.target.value)} className="rounded-xl border px-3 py-2.5"><option value="all">All Godowns</option>{filteredGodownsForFilter.map(g=><option key={g.id} value={g.id}>{bilingual(g.name,g.name_urdu)}</option>)}</SearchableSelect><SearchableSelect value={itemFilter} onChange={e=>setItemFilter(e.target.value)} className="rounded-xl border px-3 py-2.5"><option value="all">All Items</option>{items.map(i=><option key={i.id} value={i.id} data-search={`${i.sku} ${clean(i.unit)}`}>{bilingual(i.name,i.name_urdu)}</option>)}</SearchableSelect></div><div className="mt-3 flex justify-end gap-2"><button type="button" onClick={()=>void fetchData()} className="btn-secondary"><RefreshCw className="h-4 w-4"/>Refresh</button><button type="button" onClick={exportExcel} className="btn-secondary"><FileSpreadsheet className="h-4 w-4"/>Export Excel</button><button type="button" onClick={printPdf} className="btn-secondary"><Printer className="h-4 w-4"/>Print / PDF</button></div></div>
  <div className="overflow-hidden rounded-2xl border bg-white"><div className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="font-bold">Current Stock</h2><p className="mt-1 text-xs text-slate-500">Warehouse → Godown → Item</p></div><WarehouseIcon className="h-5 w-5 text-slate-400"/></div><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="border-b bg-slate-50"><tr>{["Warehouse","Godown","Item","Grade","Size","Quantity / UOM","Updated"].map(h=><th key={h} className="px-5 py-3 text-xs font-bold uppercase text-slate-500">{h}</th>)}</tr></thead><tbody className="divide-y">{loading?<tr><td colSpan={7} className="px-5 py-12 text-center">Loading stock...</td></tr>:filteredStock.length===0?<tr><td colSpan={7} className="px-5 py-12 text-center">No stock records found.</td></tr>:filteredStock.map(r=><tr key={r.id}><td className="px-5 py-4 font-semibold">{warehouseName(r.warehouse_id)}</td><td className="px-5 py-4">{godownName(r.godown_id,r.godown)}</td><td className="px-5 py-4 font-bold">{r.item?bilingual(r.item.name,r.item.name_urdu):"Unknown Item"}</td><td className="px-5 py-4">{r.item?.grade||"—"}</td><td className="px-5 py-4">{r.item?.size||"—"}</td><td className="px-5 py-4 text-right font-bold whitespace-nowrap">{qtyText(Number(r.quantity||0),r.item?.unit)}</td><td className="px-5 py-4 text-xs">{new Date(r.updated_at).toLocaleString("en-GB")}</td></tr>)}</tbody></table></div></div>

  {modalOpen&&<div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-4"><div className="max-h-[94vh] w-full max-w-xl overflow-y-auto rounded-2xl border bg-white"><div className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="font-bold">Controlled Stock Adjustment</h2><p className="mt-1 text-xs text-slate-500">Enter only the quantity to Add or Remove. Source-document stock cannot be created here.</p></div><button type="button" onClick={closeModal}><X className="h-5 w-5"/></button></div><form onSubmit={saveAdjustment} className="space-y-4 p-5">
   <div><label className="mb-1.5 block text-sm font-bold">Item *</label><SearchableSelect required value={form.item_id} onChange={e=>setForm(c=>({...c,item_id:e.target.value}))} className="w-full rounded-xl border px-3 py-2.5"><option value="">Select item</option>{items.map(i=><option key={i.id} value={i.id} data-search={`${i.sku} ${clean(i.unit)}`}>{bilingual(i.name,i.name_urdu)}</option>)}</SearchableSelect></div>
   <div className="grid gap-4 md:grid-cols-2"><div><label className="mb-1.5 block text-sm font-bold">Warehouse *</label><SearchableSelect required value={form.warehouse_id} onChange={e=>{const wid=e.target.value;const first=godowns.find(g=>g.warehouse_id===wid);setForm(c=>({...c,warehouse_id:wid,godown_id:first?.id??""}))}} className="w-full rounded-xl border px-3 py-2.5"><option value="">Select warehouse</option>{warehouses.map(w=><option key={w.id} value={w.id}>{bilingual(w.name,w.name_urdu)}</option>)}</SearchableSelect></div><div><label className="mb-1.5 block text-sm font-bold">Godown *</label><SearchableSelect required value={form.godown_id} disabled={!form.warehouse_id} onChange={e=>setForm(c=>({...c,godown_id:e.target.value}))} className="w-full rounded-xl border px-3 py-2.5"><option value="">Select godown</option>{modalGodowns.map(g=><option key={g.id} value={g.id}>{bilingual(g.name,g.name_urdu)}</option>)}</SearchableSelect></div></div>
   <div className="grid gap-4 md:grid-cols-2"><div><label className="mb-1.5 block text-sm font-bold">Adjustment Type *</label><SearchableSelect value={form.action} onChange={e=>setForm(c=>({...c,action:e.target.value as AdjustmentAction}))} className="w-full rounded-xl border px-3 py-2.5"><option value="remove">Stock Remove</option><option value="add">Stock Add</option></SearchableSelect></div><div><label className="mb-1.5 block text-sm font-bold">Quantity *</label><div className="flex overflow-hidden rounded-xl border"><input required type="number" min="0.001" step="0.001" value={form.qty} onChange={e=>setForm(c=>({...c,qty:e.target.value}))} className="min-w-0 flex-1 border-0 px-3 py-2.5 outline-none"/><span className="flex min-w-[64px] items-center justify-center border-l bg-slate-50 px-3 font-bold">{uom}</span></div></div></div>
   {form.item_id&&form.godown_id&&<div className="grid grid-cols-3 gap-2 rounded-xl border bg-slate-50 p-3 text-center text-xs"><div><div className="text-slate-500">Current</div><div className="mt-1 font-bold">{qtyText(currentStock,uom)}</div></div><div><div className="text-slate-500">Adjustment</div><div className={`mt-1 font-bold ${form.action==="remove"?"text-rose-600":"text-emerald-600"}`}>{form.action==="remove"?"-":"+"}{qtyText(adjustmentQty,uom)}</div></div><div><div className="text-slate-500">Result</div><div className={`mt-1 font-bold ${resultingStock<0?"text-rose-600":""}`}>{qtyText(resultingStock,uom)}</div></div></div>}
   <div><label className="mb-1.5 block text-sm font-bold">Reason *</label><SearchableSelect required value={form.reason_code} onChange={e=>setForm(c=>({...c,reason_code:e.target.value}))} className="w-full rounded-xl border px-3 py-2.5"><option value="">Select reason</option>{REASONS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</SearchableSelect></div>
   <div><label className="mb-1.5 block text-sm font-bold">Reference / Approval No. *</label><input required value={form.reference} onChange={e=>setForm(c=>({...c,reference:e.target.value}))} placeholder="Count sheet, approval memo, incident ref..." className="w-full rounded-xl border px-3 py-2.5"/></div>
   <div><label className="mb-1.5 block text-sm font-bold">Approved By *</label><SearchableSelect required value={form.approved_by_employee_id} onChange={e=>setForm(c=>({...c,approved_by_employee_id:e.target.value}))} className="w-full rounded-xl border px-3 py-2.5"><option value="">Select approver</option>{employees.map(emp=><option key={emp.id} value={emp.id} data-search={emp.employee_code || undefined}>{bilingual(emp.name,emp.name_urdu)}{emp.designation?` — ${emp.designation}`:""}</option>)}</SearchableSelect></div>
   <div><label className="mb-1.5 block text-sm font-bold">Approved Slip *</label><label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm font-semibold text-slate-700"><Upload className="h-4 w-4"/>{slipFile?slipFile.name:"Upload signed/approved PDF or image"}<input type="file" required accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={e=>setSlipFile(e.target.files?.[0]??null)}/></label><p className="mt-1 text-xs text-slate-500">PDF/JPG/PNG/WEBP, maximum 5 MB. Adjustment will not save without approval slip.</p></div>
   <div><label className="mb-1.5 block text-sm font-bold">Remarks {form.reason_code==="other"?"*":""}</label><textarea rows={2} required={form.reason_code==="other"} value={form.remarks} onChange={e=>setForm(c=>({...c,remarks:e.target.value}))} placeholder="Optional detail; required for Other reason" className="w-full rounded-xl border px-3 py-2.5"/></div>
   <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><strong>Strict audit rule:</strong> Reason, reference, approver and approved slip are mandatory. Logged-in user, old stock and resulting stock are stored automatically.</div>
   <div className="flex justify-end gap-2 border-t pt-4"><button type="button" onClick={closeModal} className="btn-secondary"><X className="h-4 w-4"/>Cancel</button><button type="submit" disabled={saving||resultingStock<0} className="btn-primary"><Save className="h-4 w-4"/>{saving?"Saving...":"Save Adjustment"}</button></div>
  </form></div></div>}
 </div>
}
