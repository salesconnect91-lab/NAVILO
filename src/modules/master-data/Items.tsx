import SearchableSelect from "@/components/SearchableSelect";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { toUrduName } from "@/lib/urdu";
import { Download, Filter, Package, Plus, Search, Upload, X } from "lucide-react";

type ItemType = "raw" | "component" | "finished";
type Item = { id:string; sku:string; name:string; name_urdu:string|null; type:string|null; grade:string|null; size:string|null; unit:string|null; hs_code:string|null; cost:number|null; price:number|null; category_id:string|null };
type Category={id:string;name:string;name_urdu:string|null};
type Uom={id:string;name:string;name_urdu:string|null;symbol:string};
type ColumnKey="sku"|"item"|"urdu"|"type"|"category"|"hs"|"unit"|"size"|"grade"|"cost"|"price";

type ItemForm = {
  sku:string; name:string; name_urdu:string; type:ItemType; grade:string; size:string; unit:string; hs_code:string;
  cost:string; price:string; category_id:string;
};

const EMPTY:ItemForm={sku:"",name:"",name_urdu:"",type:"finished",grade:"",size:"",unit:"",hs_code:"",cost:"0",price:"0",category_id:""};
const DEFAULT_COLUMNS:Record<ColumnKey,boolean>={sku:true,item:true,urdu:true,type:true,category:true,hs:true,unit:true,size:true,grade:true,cost:true,price:true};
const COLUMN_LABELS:Record<ColumnKey,string>={sku:"SKU",item:"Item",urdu:"Urdu Name",type:"Type",category:"Category",hs:"HS/PCT",unit:"UOM",size:"Size",grade:"Grade",cost:"Cost",price:"Sale Price"};
const n=(v:unknown)=>String(v??"").trim().toLowerCase();
const num=(v:string)=>Number.isFinite(Number(v))?Number(v):0;
const prefix=(t:ItemType)=>t==="raw"?"RAW":t==="component"?"CMP":"FG";

async function nextSku(t:ItemType){
  const p=prefix(t),{data,error}=await supabase.from("items").select("sku").ilike("sku",`${p}-%`);if(error)throw error;
  let m=0;(data??[]).forEach(r=>{const x=String(r.sku??"").match(new RegExp(`^${p}-(\\d+)$`,`i`));if(x)m=Math.max(m,Number(x[1]))});
  return `${p}-${String(m+1).padStart(3,"0")}`;
}

export default function Items(){
  const[items,setItems]=useState<Item[]>([]),[categories,setCategories]=useState<Category[]>([]),[uoms,setUoms]=useState<Uom[]>([]);
  const[form,setForm]=useState<ItemForm>(EMPTY),[edit,setEdit]=useState<Item|null>(null),[open,setOpen]=useState(false),[search,setSearch]=useState("");
  const[typeFilter,setTypeFilter]=useState("all"),[categoryFilter,setCategoryFilter]=useState("all");
  const[filtersOpen,setFiltersOpen]=useState(false),[importOpen,setImportOpen]=useState(false),[customizeOpen,setCustomizeOpen]=useState(false);
  const[columns,setColumns]=useState<Record<ColumnKey,boolean>>(()=>{try{return{...DEFAULT_COLUMNS,...JSON.parse(localStorage.getItem("navilo-items-columns")||"{}")}}catch{return DEFAULT_COLUMNS}});
  const[error,setError]=useState(""),[saving,setSaving]=useState(false),[languageVersion,setLanguageVersion]=useState(0),[nameManual,setNameManual]=useState(false);

  const load=async()=>{const[i,c,u]=await Promise.all([supabase.from("items").select("id,sku,name,name_urdu,type,grade,size,unit,hs_code,cost,price,category_id").order("name"),supabase.from("categories").select("id,name,name_urdu").order("name"),supabase.from("uom").select("id,name,name_urdu,symbol").order("name")]);if(i.error||c.error||u.error)setError(i.error?.message||c.error?.message||u.error?.message||"Load failed");else{setItems((i.data??[]) as Item[]);setCategories((c.data??[]) as Category[]);setUoms((u.data??[]) as Uom[])}};
  useEffect(()=>{void load()},[]);
  useEffect(()=>{const h=()=>setCustomizeOpen(true);window.addEventListener("navilo:report-customize",h);return()=>window.removeEventListener("navilo:report-customize",h)},[]);
  useEffect(()=>{const h=()=>setLanguageVersion(v=>v+1);window.addEventListener("navilo-language-changed",h);window.addEventListener("navilo:language-changed",h);return()=>{window.removeEventListener("navilo-language-changed",h);window.removeEventListener("navilo:language-changed",h)}},[]);
  useEffect(()=>{localStorage.setItem("navilo-items-columns",JSON.stringify(columns))},[columns]);

  const languageState=useMemo(()=>({mode:document.documentElement.dataset.languageMode||"single",primary:document.documentElement.dataset.primaryLanguage||"en"}),[languageVersion]);
  const showUrdu=languageState.mode==="bilingual"||languageState.primary==="ur";
  const masterLabel=(english:string,secondary?:string|null,symbol?:string)=>{
    const en=symbol?`${english} (${symbol})`:english;
    const other=String(secondary||"").trim();
    if(languageState.mode==="bilingual"&&other)return `${en} — ${other}`;
    if(languageState.primary==="ur"&&other)return symbol?`${other} (${symbol})`:other;
    return en;
  };

  const cat=(id:string|null)=>categories.find(x=>x.id===id);
  const buildItemName=(categoryId:string,size:string,grade:string)=>{
    const categoryName=cat(categoryId)?.name?.trim()||"";
    const cleanSize=size.trim().replace(/\s+/g," ");
    const cleanGrade=grade.trim().replace(/\s+/g," ");
    if(!categoryName)return "";
    if(!cleanSize&&!cleanGrade)return categoryName;
    if(cleanSize.includes(" x ")){
      const[first,...rest]=cleanSize.split(/\s+x\s+/i);
      const firstCompact=first.replace(/(\d)\s+(mm|cm)\b/gi,"$1$2");
      const tail=rest.join(" x ").trim();
      return [categoryName,firstCompact,cleanGrade,tail?`- ${tail}`:""].filter(Boolean).join(" ");
    }
    return [categoryName,cleanSize,cleanGrade].filter(Boolean).join(" ");
  };
  const applyGeneratedName=(draft:ItemForm)=>{
    const generated=buildItemName(draft.category_id,draft.size,draft.grade);
    if(!generated)return draft;
    const urduWasAuto=!draft.name_urdu||draft.name_urdu===toUrduName(draft.name);
    return {...draft,name:generated,name_urdu:urduWasAuto?toUrduName(generated):draft.name_urdu};
  };
  const updateStructuredField=(patch:Partial<ItemForm>)=>setForm(current=>{
    const next={...current,...patch};
    return nameManual?next:applyGeneratedName(next);
  });

  const shown=useMemo(()=>items.filter(x=>(typeFilter==="all"||x.type===typeFilter)&&(categoryFilter==="all"||x.category_id===categoryFilter)&&(!search||[x.sku,x.name,showUrdu?x.name_urdu:null,x.grade,x.size,x.hs_code,x.unit,cat(x.category_id)?.name,showUrdu?cat(x.category_id)?.name_urdu:null].some(v=>n(v).includes(n(search))))),[items,search,typeFilter,categoryFilter,categories,showUrdu]);
  const activeFilterCount=[typeFilter!=="all",categoryFilter!=="all"].filter(Boolean).length;
  const totalCost=shown.reduce((s,x)=>s+Number(x.cost||0),0),totalPrice=shown.reduce((s,x)=>s+Number(x.price||0),0);

  const start=async()=>{try{setEdit(null);setNameManual(false);const defaultUnit=uoms.find(u=>n(u.symbol)==="kg")?.symbol??uoms[0]?.symbol??"";setForm({...EMPTY,sku:await nextSku("finished"),unit:defaultUnit});setOpen(true)}catch(x){setError(x instanceof Error?x.message:"SKU generation failed")}};
  const save=async(e:FormEvent)=>{
    e.preventDefault();setSaving(true);setError("");
    try{
      const resolvedName=(form.name.trim()||buildItemName(form.category_id,form.size,form.grade)).trim();
      if(!resolvedName)throw new Error("Item name is required. Select a category and enter size/grade, or type a manual name.");
      const duplicateName=items.find(x=>x.id!==edit?.id&&n(x.name)===n(resolvedName));
      if(duplicateName)throw new Error(`Duplicate item name: ${duplicateName.name}.`);
      const sku=edit?edit.sku:await nextSku(form.type);
      const duplicateSku=items.find(x=>x.id!==edit?.id&&n(x.sku)===n(sku));
      if(duplicateSku)throw new Error(`Duplicate SKU: ${sku}.`);
      const p={sku,name:resolvedName,name_urdu:showUrdu?(form.name_urdu.trim()||toUrduName(resolvedName)):(edit?.name_urdu??null),type:form.type,grade:form.grade.trim()||null,size:form.size.trim()||null,unit:form.unit.trim()||null,hs_code:form.hs_code.trim()||null,cost:num(form.cost),price:num(form.price),category_id:form.category_id||null};
      const q=edit?await supabase.from("items").update(p).eq("id",edit.id):await supabase.from("items").insert(p);if(q.error)throw q.error;
      setOpen(false);setEdit(null);setNameManual(false);setForm(EMPTY);await load();
    }catch(x){setError(x instanceof Error?x.message:"Save failed")}finally{setSaving(false)}
  };
  const del=async(x:Item)=>{if(!confirm(`Delete ${x.name}? Historical-use protection may block deletion.`))return;const{error}=await supabase.from("items").delete().eq("id",x.id);if(error)setError(error.message);else await load()};
  const editItem=(x:Item)=>{const next:ItemForm={sku:x.sku,name:x.name,name_urdu:x.name_urdu??toUrduName(x.name),type:(x.type as ItemType)||"finished",grade:x.grade??"",size:x.size??"",unit:x.unit??"",hs_code:x.hs_code??"",cost:String(x.cost??0),price:String(x.price??0),category_id:x.category_id??""};setEdit(x);setForm(next);setNameManual(n(x.name)!==n(buildItemName(next.category_id,next.size,next.grade)));setOpen(true)};

  const template=()=>{const ws=XLSX.utils.json_to_sheet([{"Item Name":"Sarya 12mm Grade 60 - 40 ft",...(showUrdu?{"Urdu Name":"سریا 12 ایم ایم گریڈ 60 - 40 فٹ"}:{}),Type:"finished",Category:categories[0]?.name??"",Grade:"Grade 60",Size:"12 mm x 40 ft",Unit:uoms.find(u=>n(u.symbol)==="kg")?.symbol??uoms[0]?.symbol??"","HS Code":"",Cost:0,"Sale Price":0}]);const help=XLSX.utils.aoa_to_sheet([["NAVILO Items Import Template"],["SKU","Leave blank. NAVILO generates SKU automatically."],["Item Name","Optional when Category is supplied; NAVILO can auto-build the name from Category + Size + Grade."],...(showUrdu?[["Urdu Name","Optional; Auto Urdu is used if blank"]]:[]),["Type","raw, component or finished"],["Category","Optional; must match an existing master name"],["Warehouse","Not part of Item Master. Assign stock locations through inventory transactions."],["Unit","Use an existing UOM symbol or name"],["HS Code","Applicable HS/PCT classification"],["Cost / Sale Price","Optional numeric values"],["Important","Do not change column headers"]]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Items Template");XLSX.utils.book_append_sheet(wb,help,"Instructions");XLSX.writeFile(wb,"NAVILO_Items_Import_Template.xlsx")};
const imp=async(e:ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];e.target.value="";if(!f)return;setError("");try{const wb=XLSX.read(await f.arrayBuffer(),{type:"array"}),raw=XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets[wb.SheetNames[0]],{defval:""});const{data:skuRows,error:skuError}=await supabase.from("items").select("sku");if(skuError)throw new Error(skuError.message);const counters:Record<ItemType,number>={raw:0,component:0,finished:0};for(const row of skuRows??[]){for(const type of ["raw","component","finished"] as ItemType[]){const p=prefix(type),m=String(row.sku??"").match(new RegExp(`^${p}-(\\d+)$`,`i`));if(m)counters[type]=Math.max(counters[type],Number(m[1]))}}const allocateSku=(type:ItemType)=>`${prefix(type)}-${String(++counters[type]).padStart(3,"0")}`;const payload=[] as any[];const seenNames=new Set(items.map(x=>n(x.name)));for(const x of raw){const o=Object.fromEntries(Object.entries(x).map(([k,v])=>[n(k),String(v??"").trim()]));const category=categories.find(c=>n(c.name)===n(o.category));const grade=o.grade||"",size=o.size||"";let name=o["item name"]||o.name||"";if(!name&&category)name=buildItemName(category.id,size,grade);if(!name)continue;if(seenNames.has(n(name)))continue;seenNames.add(n(name));const type=(o.type==="raw"||o.type==="component"?o.type:"finished") as ItemType;payload.push({sku:allocateSku(type),name,name_urdu:showUrdu?(o["urdu name"]||o["name urdu"]||toUrduName(name)):null,type,grade:grade||null,size:size||null,unit:(uoms.find(u=>n(u.symbol)===n(o.unit)||n(u.name)===n(o.unit))?.symbol??o.unit)||null,hs_code:o["hs code"]||o["hs/pct code"]||o["pct code"]||null,cost:num(o.cost||"0"),price:num(o["sale price"]||o.price||"0"),category_id:category?.id||null})}if(!payload.length)throw new Error("No valid new item rows found. Duplicate rows are skipped.");const{error}=await supabase.from("items").insert(payload);if(error)throw new Error(error.message);await load();setImportOpen(false)}catch(x){setError(x instanceof Error?x.message:"Import failed")}};
  const clearFilters=()=>{setTypeFilter("all");setCategoryFilter("all")};

  const visible=(key:ColumnKey)=>columns[key]&&(key!=="urdu"||showUrdu);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3" data-no-print data-no-export>
      <div><h1 className="flex items-center gap-2 text-2xl font-bold"><Package className="h-6 w-6"/>Items</h1><p className="text-sm text-slate-500">Item, UOM and statutory HS/PCT identity used by Sales and Purchase invoices.</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={()=>setFiltersOpen(v=>!v)}><Filter className="h-4 w-4"/>Filters{activeFilterCount?` (${activeFilterCount})`:""}</button>
        <button type="button" className="btn-secondary" onClick={()=>setImportOpen(true)}><Upload className="h-4 w-4"/>Import</button>
        <button type="button" className="btn-primary" onClick={()=>void start()}><Plus className="h-4 w-4"/>Add Item</button>
      </div>
    </div>

    {error&&<div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700" data-no-print data-no-export>{error}</div>}

    <div className="space-y-3" data-no-print data-no-export>
      <label className="relative block min-w-0"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input className="h-10 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search SKU, item, category, HS/PCT, UOM, size or grade..."/></label>
      {filtersOpen&&<div className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-3">
        <div><label className="label">Type</label><SearchableSelect className="input" value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option value="all">All Types</option><option value="raw">Raw</option><option value="component">Component</option><option value="finished">Finished</option></SearchableSelect></div>
        <div><label className="label">Category</label><SearchableSelect className="input" value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}><option value="all">All Categories</option>{categories.map(c=><option key={c.id} value={c.id}>{masterLabel(c.name,c.name_urdu)}</option>)}</SearchableSelect></div>
        <div className="flex items-end"><button type="button" className="btn-secondary w-full justify-center" onClick={clearFilters}>Clear Filters</button></div>
      </div>}
    </div>

    <section data-report-content className="space-y-3 rounded-xl bg-white print:shadow-none">
      <div className="border-b border-slate-200 px-4 py-4">
        <div className="navilo-report-title text-xl font-bold text-slate-900">Items Master</div>
        <div className="mt-1 text-xs text-slate-500">{shown.length} item(s) • {typeFilter==="all"?"All types":typeFilter} • {categoryFilter==="all"?"All categories":cat(categoryFilter)?.name||"Selected category"}</div>
        {search&&<div className="mt-1 text-xs text-slate-500">Search: {search}</div>}
      </div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50"><tr>
        {visible("sku")&&<th className="p-3 text-left">SKU</th>}{visible("item")&&<th className="p-3 text-left">Item</th>}{visible("urdu")&&<th className="p-3 text-right">Urdu Name</th>}{visible("type")&&<th className="p-3 text-left">Type</th>}{visible("category")&&<th className="p-3 text-left">Category</th>}{visible("hs")&&<th className="p-3 text-left">HS/PCT</th>}{visible("unit")&&<th className="p-3 text-left">UOM</th>}{visible("size")&&<th className="p-3 text-left">Size</th>}{visible("grade")&&<th className="p-3 text-left">Grade</th>}{visible("cost")&&<th className="p-3 text-right">Cost</th>}{visible("price")&&<th className="p-3 text-right">Sale Price</th>}<th className="p-3" data-no-print data-no-export/>
      </tr></thead><tbody>{shown.map(x=><tr key={x.id} className="border-t">
        {visible("sku")&&<td className="p-3">{x.sku}</td>}{visible("item")&&<td className="p-3 font-medium">{x.name}</td>}{visible("urdu")&&<td className="p-3 text-right" dir="rtl">{x.name_urdu||"—"}</td>}{visible("type")&&<td className="p-3 capitalize">{x.type||"—"}</td>}{visible("category")&&<td className="p-3">{cat(x.category_id)?.name||"—"}</td>}{visible("hs")&&<td className="p-3">{x.hs_code||"—"}</td>}{visible("unit")&&<td className="p-3">{x.unit||"—"}</td>}{visible("size")&&<td className="p-3">{x.size||"—"}</td>}{visible("grade")&&<td className="p-3">{x.grade||"—"}</td>}{visible("cost")&&<td className="p-3 text-right">{Number(x.cost||0).toLocaleString()}</td>}{visible("price")&&<td className="p-3 text-right">{Number(x.price||0).toLocaleString()}</td>}
        <td className="p-3 text-right whitespace-nowrap" data-no-print data-no-export><button className="mr-3 text-primary-600" onClick={()=>editItem(x)}>Edit</button><button className="text-red-600" onClick={()=>void del(x)}>Delete</button></td>
      </tr>)}</tbody><tfoot><tr className="border-t bg-slate-50 font-semibold"><td className="p-3" colSpan={Math.max(1,(Object.keys(columns) as ColumnKey[]).filter(visible).length-2)}>TOTAL / SUMMARY</td>{visible("cost")&&<td className="p-3 text-right">{totalCost.toLocaleString()}</td>}{visible("price")&&<td className="p-3 text-right">{totalPrice.toLocaleString()}</td>}<td data-no-print data-no-export/></tr></tfoot></table></div>
    </section>

    {importOpen&&<div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4" data-no-print data-no-export><div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Import Items</h2><p className="text-sm text-slate-500">Use one standard NAVILO template, then choose the completed file.</p></div><button type="button" onClick={()=>setImportOpen(false)}><X className="h-5 w-5"/></button></div><div className="mt-5 grid gap-3"><button type="button" className="btn-secondary justify-center" onClick={template}><Download className="h-4 w-4"/>Download Template</button><label className="btn-primary cursor-pointer justify-center"><Upload className="h-4 w-4"/>Choose File<input hidden type="file" accept=".xlsx,.xls,.csv" onChange={imp}/></label><p className="text-xs text-slate-500">Accepted: .xlsx, .xls, .csv. SKU is generated automatically.</p></div></div></div>}

    {customizeOpen&&<div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4" data-no-print data-no-export><div className="w-full max-w-xl rounded-xl bg-white p-6 shadow-xl"><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Customize Items View</h2><p className="text-sm text-slate-500">These visible columns are also used by Print and Export.</p></div><button type="button" onClick={()=>setCustomizeOpen(false)}><X className="h-5 w-5"/></button></div><div className="mt-4 grid gap-2 sm:grid-cols-2">{(Object.keys(COLUMN_LABELS) as ColumnKey[]).filter(key=>key!=="urdu"||showUrdu).map(key=><label key={key} className="flex items-center gap-2 rounded-lg border px-3 py-2"><input type="checkbox" checked={columns[key]} onChange={e=>setColumns(v=>({...v,[key]:e.target.checked}))}/><span>{COLUMN_LABELS[key]}</span></label>)}</div><div className="mt-5 flex justify-between"><button type="button" className="btn-secondary" onClick={()=>setColumns(DEFAULT_COLUMNS)}>Reset Default</button><button type="button" className="btn-primary" onClick={()=>setCustomizeOpen(false)}>Done</button></div></div></div>}

    {open&&<div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4" data-no-print data-no-export><form onSubmit={save} className="max-h-[90vh] w-full max-w-2xl space-y-3 overflow-visible rounded-xl bg-white p-6 shadow-xl"><h2 className="text-lg font-bold">{edit?"Edit Item":"Add Item"}</h2><div className="grid gap-3 sm:grid-cols-2">
      <div><label className="label">SKU</label><input className="input cursor-not-allowed bg-slate-100 text-slate-600" value={form.sku} readOnly tabIndex={-1}/></div>
      <div><label className="label">Type</label><SearchableSelect className="input" value={form.type} onChange={async e=>{const type=e.target.value as ItemType;if(edit){setForm(x=>({...x,type}));return;}try{const sku=await nextSku(type);setForm(x=>({...x,type,sku}))}catch(x){setError(x instanceof Error?x.message:"SKU generation failed")}}}><option value="raw">Raw</option><option value="component">Component</option><option value="finished">Finished</option></SearchableSelect></div>
      <div><div className="flex items-center justify-between"><label className="label">Item Name (English)</label><button type="button" className="text-xs font-semibold text-primary-600" onClick={()=>{setNameManual(false);setForm(x=>applyGeneratedName(x))}}>Auto Name</button></div><input className="input" value={form.name} onChange={e=>{setNameManual(true);setForm(x=>({...x,name:e.target.value,name_urdu:(!x.name_urdu||x.name_urdu===toUrduName(x.name))?toUrduName(e.target.value):x.name_urdu}))}} placeholder="Auto from Category + Size + Grade"/></div>
      {showUrdu&&<div><div className="flex items-center justify-between"><label className="label">Urdu Name</label><button type="button" className="text-xs font-semibold text-primary-600" onClick={()=>setForm(x=>({...x,name_urdu:toUrduName(x.name)}))}>Auto Urdu</button></div><input dir="rtl" className="input text-right" value={form.name_urdu} onChange={e=>setForm(x=>({...x,name_urdu:e.target.value}))}/></div>}
      <div><label className="label">Category</label><SearchableSelect className="input" value={form.category_id} onChange={e=>updateStructuredField({category_id:e.target.value})}><option value="">None</option>{categories.map(c=><option key={c.id} value={c.id}>{masterLabel(c.name,c.name_urdu)}</option>)}</SearchableSelect></div>
      <div><label className="label">Grade</label><input className="input" value={form.grade} onChange={e=>updateStructuredField({grade:e.target.value})}/></div>
      <div><label className="label">Size</label><input className="input" value={form.size} onChange={e=>updateStructuredField({size:e.target.value})}/></div>
      <div><label className="label">Unit</label><SearchableSelect className="input" value={form.unit} onChange={e=>setForm(x=>({...x,unit:e.target.value}))}><option value="">None</option>{uoms.map(u=><option key={u.id} value={u.symbol}>{masterLabel(u.name,u.name_urdu,u.symbol)}</option>)}</SearchableSelect></div>
      <div><label className="label">HS/PCT Code</label><input className="input" value={form.hs_code} onChange={e=>setForm(x=>({...x,hs_code:e.target.value}))} placeholder="Applicable statutory code"/></div>
      <div><label className="label">Cost</label><input type="number" step="any" className="input" value={form.cost} onChange={e=>setForm(x=>({...x,cost:e.target.value}))}/></div>
      <div><label className="label">Sale Price</label><input type="number" step="any" className="input" value={form.price} onChange={e=>setForm(x=>({...x,price:e.target.value}))}/></div>
    </div><div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-secondary" onClick={()=>{setOpen(false);setEdit(null);setNameManual(false)}}>Cancel</button><button type="submit" className="btn-primary" disabled={saving}>{saving?"Saving...":"Save Item"}</button></div></form></div>}
  </div>;
}
