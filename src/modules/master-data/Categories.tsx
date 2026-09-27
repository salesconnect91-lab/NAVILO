import MasterActionButton from "@/components/MasterActionButton";
import DataTable,{Column} from "@/components/DataTable";
import { masterDeleteError } from "@/lib/masterDeleteError";
import SearchableSelect from "@/components/SearchableSelect";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Download, Filter, Plus, Search, Upload, X, Pencil, Trash2, Power } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toUrduName } from "@/lib/urdu";
import { ConfirmModal, ErrorBanner, Modal } from "@/components/ui";

type Category={id:string;name:string;name_urdu:string|null;description:string|null;created_at:string;is_active:boolean};
type CategoryForm={name:string;name_urdu:string;description:string};
type ColumnKey="name"|"urdu"|"description"|"created";

const EMPTY_FORM:CategoryForm={name:"",name_urdu:"",description:""};
const DEFAULT_COLUMNS:Record<ColumnKey,boolean>={name:true,urdu:true,description:true,created:false};
const COLUMN_LABELS:Record<ColumnKey,string>={name:"Category Name",urdu:"Urdu Name",description:"Description",created:"Created At"};
const clean=(v:unknown)=>String(v??"").trim();
const norm=(v:unknown)=>clean(v).toLowerCase();

export default function Categories(){
 const[rows,setRows]=useState<Category[]>([]),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[languageVersion,setLanguageVersion]=useState(0);
 const[error,setError]=useState<string|null>(null),[modalOpen,setModalOpen]=useState(false),[editing,setEditing]=useState<Category|null>(null),[deleteId,setDeleteId]=useState<string|null>(null),[form,setForm]=useState<CategoryForm>(EMPTY_FORM);
 const[search,setSearch]=useState(""),[statusFilter,setStatusFilter]=useState("all"),[translationFilter,setTranslationFilter]=useState("all"),[descriptionFilter,setDescriptionFilter]=useState("all");
 const[filtersOpen,setFiltersOpen]=useState(false),[importOpen,setImportOpen]=useState(false),[customizeOpen,setCustomizeOpen]=useState(false);
 const[columns,setColumns]=useState<Record<ColumnKey,boolean>>(()=>{try{return{...DEFAULT_COLUMNS,...JSON.parse(localStorage.getItem("navilo-categories-columns")||"{}")}}catch{return DEFAULT_COLUMNS}});

 const fetchCategories=useCallback(async()=>{setLoading(true);const{data,error}=await supabase.from("categories").select("id,name,name_urdu,description,created_at,is_active").order("name");if(error){setError(error.message);setRows([])}else{setError(null);setRows((data??[]) as Category[])}setLoading(false)},[]);
 useEffect(()=>{void fetchCategories()},[fetchCategories]);
 useEffect(()=>{localStorage.setItem("navilo-categories-columns",JSON.stringify(columns))},[columns]);
 useEffect(()=>{const h=()=>setCustomizeOpen(true);window.addEventListener("navilo:report-customize",h);return()=>window.removeEventListener("navilo:report-customize",h)},[]);
 useEffect(()=>{const h=()=>setLanguageVersion(v=>v+1);window.addEventListener("navilo-language-changed",h);window.addEventListener("navilo:language-changed",h);return()=>{window.removeEventListener("navilo-language-changed",h);window.removeEventListener("navilo:language-changed",h)}},[]);

 const languageState=useMemo(()=>({mode:document.documentElement.dataset.languageMode||"single",primary:document.documentElement.dataset.primaryLanguage||"en"}),[languageVersion]);
 const showUrdu=languageState.mode==="bilingual"||languageState.primary==="ur";

 const shown=useMemo(()=>rows.filter(r=>{
   const matchesSearch=!search||[r.name,showUrdu?r.name_urdu:null,r.description].some(v=>norm(v).includes(norm(search)));\n   const matchesStatus=statusFilter==="all"||(statusFilter==="active"?r.is_active:!r.is_active);
   const matchesTranslation=!showUrdu||translationFilter==="all"||(translationFilter==="available"?Boolean(clean(r.name_urdu)):!clean(r.name_urdu));
   const matchesDescription=descriptionFilter==="all"||(descriptionFilter==="available"?Boolean(clean(r.description)):!clean(r.description));
   return matchesSearch&&matchesStatus&&matchesTranslation&&matchesDescription;
 }),[rows,search,statusFilter,translationFilter,descriptionFilter,showUrdu]);
 const activeFilterCount=[showUrdu&&translationFilter!=="all",descriptionFilter!=="all"].filter(Boolean).length;
 const visible=(key:ColumnKey)=>columns[key]&&(key!=="urdu"||showUrdu);
 const visibleCount=Math.max(1,(Object.keys(columns) as ColumnKey[]).filter(visible).length);

 const openCreate=()=>{setEditing(null);setForm(EMPTY_FORM);setError(null);setModalOpen(true)};
 const openEdit=(r:Category)=>{setEditing(r);setForm({name:r.name,name_urdu:r.name_urdu??"",description:r.description??""});setError(null);setModalOpen(true)};
 const closeModal=()=>{if(saving)return;setModalOpen(false);setEditing(null);setForm(EMPTY_FORM)};
 const submit=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const name=form.name.trim();if(!name){setError("Category name is required.");return}setSaving(true);setError(null);try{let q=supabase.from("categories").select("id").ilike("name",name).limit(1);if(editing)q=q.neq("id",editing.id);const d=await q;if(d.error)throw d.error;if((d.data??[]).length)throw new Error(`Category "${name}" already exists.`);const payload={name,name_urdu:showUrdu?(form.name_urdu.trim()||toUrduName(name)||null):(editing?.name_urdu??null),description:form.description.trim()||null};const r=editing?await supabase.from("categories").update(payload).eq("id",editing.id):await supabase.from("categories").insert(payload);if(r.error)throw r.error;setModalOpen(false);setEditing(null);setForm(EMPTY_FORM);window.dispatchEvent(new Event("navilo-master-data-changed"));await fetchCategories()}catch(x){setError(x instanceof Error?x.message:"Unable to save category.")}finally{setSaving(false)}};
 const del=async()=>{if(!deleteId)return;setSaving(true);const r=await supabase.from("categories").delete().eq("id",deleteId);if(r.error)setError(masterDeleteError(r.error));else{setDeleteId(null);window.dispatchEvent(new Event("navilo-master-data-changed"));await fetchCategories()}setSaving(false)};

 const downloadTemplate=()=>{const ws=XLSX.utils.json_to_sheet([{"Category Name":"Steel Products",...(showUrdu?{"Urdu Name":"اسٹیل مصنوعات"}:{}),Description:"Optional description"}]);const help=XLSX.utils.aoa_to_sheet([["NAVILO Categories Import Template"],["Category Name","Required and must be unique"],...(showUrdu?[["Urdu Name","Optional; NAVILO Auto Urdu is used if blank"]]:[]),["Description","Optional"],["Important","Do not change column headers"]]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Categories Template");XLSX.utils.book_append_sheet(wb,help,"Instructions");XLSX.writeFile(wb,"NAVILO_Categories_Import_Template.xlsx")};
 const importExcel=async(e:ChangeEvent<HTMLInputElement>)=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;setSaving(true);setError(null);try{const wb=XLSX.read(await file.arrayBuffer(),{type:"array"});const sheet=wb.Sheets[wb.SheetNames[0]];const raw=XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet,{defval:""});const existing=new Set(rows.map(r=>norm(r.name)));const seen=new Set<string>();const payload:{name:string;name_urdu:string|null;description:string|null}[]=[];const errors:string[]=[];raw.forEach((r,i)=>{const name=clean(r["Category Name"]??r["Name"]??r["name"]),name_urdu=showUrdu?clean(r["Urdu Name"]??r["name_urdu"]):"",description=clean(r["Description"]??r["description"]);if(!name){if(Object.values(r).some(v=>clean(v)))errors.push(`Row ${i+2}: Category Name is required.`);return}const key=norm(name);if(existing.has(key)||seen.has(key)){errors.push(`Row ${i+2}: Duplicate category "${name}".`);return}seen.add(key);payload.push({name,name_urdu:showUrdu?(name_urdu||toUrduName(name)||null):null,description:description||null})});if(errors.length)throw new Error(errors.slice(0,6).join(" "));if(!payload.length)throw new Error("No valid category rows found in the file.");const{error}=await supabase.from("categories").insert(payload);if(error)throw error;window.dispatchEvent(new Event("navilo-master-data-changed"));await fetchCategories();setImportOpen(false)}catch(x){setError(x instanceof Error?x.message:"Category import failed.")}finally{setSaving(false)}};
 const clearFilters=()=>{setStatusFilter("all");setTranslationFilter("all");setDescriptionFilter("all")};

 const toggleStatus=async(r:Category)=>{const{error}=await supabase.from("categories").update({is_active:!r.is_active}).eq("id",r.id);if(error)setError(error.message);else await fetchCategories()};
 const tableCols:Column<Category>[]=[{key:"name",label:"Category Name",render:r=><span className="font-semibold">{r.name}</span>},...(showUrdu?[{key:"urdu",label:"Urdu Name",render:(r:Category)=><span dir="rtl">{r.name_urdu||"—"}</span>} as Column<Category>]:[]),{key:"description",label:"Description",render:r=>r.description||"—"},{key:"created_at",label:"Created At",render:r=>new Date(r.created_at).toLocaleString()},{key:"status",label:"Status",render:r=><span className={`rounded-full px-2 py-1 text-xs font-semibold ${r.is_active?"bg-emerald-50 text-emerald-700":"bg-slate-100 text-slate-600"}`}>{r.is_active?"Active":"Inactive"}</span>},{key:"actions",label:"Actions",className:"text-right",render:r=><div className="flex justify-end gap-2"><button type="button" onClick={()=>openEdit(r)} className="btn-secondary inline-flex items-center gap-1 px-2 py-1 text-xs"><Pencil className="h-3.5 w-3.5"/>Edit</button><MasterActionButton tone="danger" title={r.is_active?"Deactivate Category":"Activate Category"} message="Historical records will remain safe. This only changes whether the category is active for current use." onConfirm={()=>toggleStatus(r)}><Power className="h-3.5 w-3.5"/>{r.is_active?"Deactivate":"Activate"}</MasterActionButton><button type="button" onClick={()=>setDeleteId(r.id)} className="btn-secondary inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600"><Trash2 className="h-3.5 w-3.5"/>Delete</button></div>}];
 return <div className="space-y-3" data-navilo-master-standard="true">
   <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-no-print data-no-export>
     <div className="grid min-h-[72px] grid-cols-5 divide-x divide-slate-200">
       <div className="col-span-2 flex items-center px-5"><div><h1 className="text-xl font-bold text-slate-900">Categories</h1><p className="mt-0.5 text-xs text-slate-500">Manage your item category master data</p></div></div>
       <div className="flex items-center justify-center text-center"><div><div className="text-xs text-slate-500">Total Categories</div><div className="mt-1 text-lg font-bold text-slate-900">{rows.length}</div></div></div>
       <div className="flex items-center justify-center text-center"><div><div className="text-xs text-slate-500">Active</div><div className="mt-1 text-lg font-bold text-emerald-600">{rows.filter(r=>r.is_active).length}</div></div></div>
       <div className="flex items-center justify-center text-center"><div><div className="text-xs text-slate-500">Inactive</div><div className="mt-1 text-lg font-bold text-slate-600">{rows.filter(r=>!r.is_active).length}</div></div></div>
     </div>
   </section>

   {error&&<ErrorBanner message={error}/>}

   <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm" data-no-print data-no-export>
     <div className="flex items-center gap-2 overflow-x-auto">
       <span className="contents" data-navilo-standard-toolbar-host/>
       <label className="relative min-w-[280px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500" value={search} onChange={e=>setSearch(e.target.value)} placeholder={showUrdu?"Search category, Urdu name or description...":"Search category or description..."}/></label>
       <SearchableSelect wrapperClassName="w-[125px] shrink-0" className="input !h-10" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">All Status</option><option value="active">Active</option><option value="inactive">Inactive</option></SearchableSelect>
       {showUrdu&&<SearchableSelect wrapperClassName="w-[155px] shrink-0" className="input !h-10" value={translationFilter} onChange={e=>setTranslationFilter(e.target.value)}><option value="all">All Translations</option><option value="available">Translation Available</option><option value="missing">Translation Missing</option></SearchableSelect>}
       <SearchableSelect wrapperClassName="w-[155px] shrink-0" className="input !h-10" value={descriptionFilter} onChange={e=>setDescriptionFilter(e.target.value)}><option value="all">All Descriptions</option><option value="available">With Description</option><option value="missing">Without Description</option></SearchableSelect>
       {(search||statusFilter!=="all"||translationFilter!=="all"||descriptionFilter!=="all")&&<button type="button" className="btn-secondary !h-10 px-3" onClick={()=>{setSearch("");clearFilters()}}>Clear</button>}
       <button type="button" className="btn-primary !h-10 whitespace-nowrap px-4" onClick={openCreate}><Plus className="h-4 w-4"/>Add Category</button>
     </div>
   </section>

   <div data-report-content data-navilo-customizable="true" data-navilo-print-surface className="contents"><DataTable showSerialNumber columns={tableCols} rows={shown} loading={loading} emptyMessage="No categories found." /></div>

   {importOpen&&<div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4" data-no-print data-no-export><div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Import Categories</h2><p className="text-sm text-slate-500">Download the NAVILO template, complete it, then choose the file.</p></div><button type="button" onClick={()=>setImportOpen(false)}><X className="h-5 w-5"/></button></div><div className="mt-5 grid gap-3"><button type="button" className="btn-secondary justify-center" onClick={downloadTemplate}><Download className="h-4 w-4"/>Download Template</button><label className="btn-primary cursor-pointer justify-center"><Upload className="h-4 w-4"/>Choose File<input hidden type="file" accept=".xlsx,.xls,.csv" onChange={importExcel}/></label><p className="text-xs text-slate-500">Accepted: .xlsx, .xls, .csv. Duplicate category names are blocked.</p></div></div></div>}

   

   <Modal open={modalOpen} title={editing?"Edit Category":"Add Category"} onClose={closeModal}><form onSubmit={submit} className="space-y-4"><div><label className="label">Category Name (English)</label><input className="input" required autoFocus value={form.name} onChange={e=>setForm(c=>({...c,name:e.target.value,name_urdu:(!c.name_urdu||c.name_urdu===toUrduName(c.name))?toUrduName(e.target.value):c.name_urdu}))}/></div>{showUrdu&&<div><div className="flex items-center justify-between"><label className="label">Urdu Name</label><button type="button" className="text-xs font-semibold text-primary-600" onClick={()=>setForm(c=>({...c,name_urdu:toUrduName(c.name)}))}>Auto Urdu</button></div><input className="input text-right" dir="rtl" value={form.name_urdu} onChange={e=>setForm(c=>({...c,name_urdu:e.target.value}))}/></div>}<div><label className="label">Description</label><input className="input" value={form.description} onChange={e=>setForm(c=>({...c,description:e.target.value}))}/></div><div className="flex justify-end gap-3"><button type="button" onClick={closeModal} disabled={saving} className="btn-secondary">Cancel</button><button type="submit" disabled={saving} className="btn-primary">{saving?"Saving...":editing?"Save Changes":"Save Category"}</button></div></form></Modal>
   <ConfirmModal tone="danger" open={!!deleteId} title="Delete Category" message="Are you sure? Categories already used by items may be protected by database relationships." onConfirm={del} onCancel={()=>setDeleteId(null)}/>
 </div>;
}
