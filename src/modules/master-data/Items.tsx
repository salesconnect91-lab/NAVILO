import MasterActionButton from "@/components/MasterActionButton";
import DataTable,{Column} from "@/components/DataTable";
import { masterDeleteError } from "@/lib/masterDeleteError";
import SearchableSelect from "@/components/SearchableSelect";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { toUrduName } from "@/lib/urdu";
import { Package, Plus, Search, Pencil, Trash2, Power, CheckCircle2, XCircle, Layers3 } from "lucide-react";

type ItemType = "raw" | "component" | "finished";
type Item = { id:string; sku:string; name:string; name_urdu:string|null; type:string|null; grade:string|null; size:string|null; unit:string|null; hs_code:string|null; cost:number|null; price:number|null; category_id:string|null; is_active:boolean };
type Category={id:string;name:string;name_urdu:string|null};
type Uom={id:string;name:string;name_urdu:string|null;symbol:string};
type ColumnKey="sku"|"item"|"urdu"|"type"|"category"|"hs"|"unit"|"size"|"grade"|"cost"|"price";

type ItemForm = {
  sku:string; name:string; name_urdu:string; type:ItemType; grade:string; size:string; unit:string; hs_code:string;
  cost:string; price:string; category_id:string;
};

const EMPTY:ItemForm={sku:"",name:"",name_urdu:"",type:"finished",grade:"",size:"",unit:"",hs_code:"",cost:"0",price:"0",category_id:""};
const DEFAULT_COLUMNS:Record<ColumnKey,boolean>={sku:false,item:true,urdu:true,type:true,category:true,hs:true,unit:true,size:true,grade:true,cost:true,price:true};
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
  const[typeFilter,setTypeFilter]=useState("all"),[categoryFilter,setCategoryFilter]=useState("all"),[statusFilter,setStatusFilter]=useState("all"),[uomFilter,setUomFilter]=useState("all");
  const[customizeOpen,setCustomizeOpen]=useState(false);
  const[columns,setColumns]=useState<Record<ColumnKey,boolean>>(()=>{try{return{...DEFAULT_COLUMNS,...JSON.parse(localStorage.getItem("navilo-items-columns")||"{}")}}catch{return DEFAULT_COLUMNS}});
  const[error,setError]=useState(""),[saving,setSaving]=useState(false),[languageVersion,setLanguageVersion]=useState(0),[nameManual,setNameManual]=useState(false);

  const load=async()=>{const[i,c,u]=await Promise.all([supabase.from("items").select("id,sku,name,name_urdu,type,grade,size,unit,hs_code,cost,price,category_id,is_active").order("name"),supabase.from("categories").select("id,name,name_urdu").order("name"),supabase.from("uom").select("id,name,name_urdu,symbol").order("name")]);if(i.error||c.error||u.error)setError(i.error?.message||c.error?.message||u.error?.message||"Load failed");else{setItems((i.data??[]) as Item[]);setCategories((c.data??[]) as Category[]);setUoms((u.data??[]) as Uom[])}};
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

  const shown=useMemo(()=>items.filter(x=>(typeFilter==="all"||x.type===typeFilter)&&(categoryFilter==="all"||x.category_id===categoryFilter)&&(statusFilter==="all"||(statusFilter==="active"?x.is_active:!x.is_active))&&(uomFilter==="all"||x.unit===uomFilter)&&(!search||[x.name,showUrdu?x.name_urdu:null,x.grade,x.size,x.hs_code,x.unit,cat(x.category_id)?.name,showUrdu?cat(x.category_id)?.name_urdu:null].some(v=>n(v).includes(n(search))))),[items,search,typeFilter,categoryFilter,statusFilter,uomFilter,categories,showUrdu]);
  const activeCount=items.filter(x=>x.is_active).length;
  const inactiveCount=items.length-activeCount;
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
  const del=async(x:Item)=>{const{error}=await supabase.from("items").delete().eq("id",x.id);if(error)setError(masterDeleteError(error));else await load()};
  const editItem=(x:Item)=>{const next:ItemForm={sku:x.sku,name:x.name,name_urdu:x.name_urdu??toUrduName(x.name),type:(x.type as ItemType)||"finished",grade:x.grade??"",size:x.size??"",unit:x.unit??"",hs_code:x.hs_code??"",cost:String(x.cost??0),price:String(x.price??0),category_id:x.category_id??""};setEdit(x);setForm(next);setNameManual(n(x.name)!==n(buildItemName(next.category_id,next.size,next.grade)));setOpen(true)};

  const clearFilters=()=>{setTypeFilter("all");setCategoryFilter("all");setStatusFilter("all");setUomFilter("all")};

  const visible=(key:ColumnKey)=>columns[key]&&(key!=="urdu"||showUrdu);
  const toggleStatus=async(x:Item)=>{const{error}=await supabase.from("items").update({is_active:!x.is_active}).eq("id",x.id);if(error)setError(error.message);else await load()};
  const tableCols:Column<Item>[]=[{key:"name",label:"Item",render:x=><span className="font-medium">{x.name}</span>},...(showUrdu?[{key:"urdu",label:"Urdu Name",render:(x:Item)=><span dir="rtl">{x.name_urdu||"—"}</span>} as Column<Item>]:[]),{key:"type",label:"Type",render:x=><span className="capitalize">{x.type||"—"}</span>},{key:"category",label:"Category",render:x=>cat(x.category_id)?.name||"—"},{key:"hs",label:"HS/PCT",render:x=>x.hs_code||"—"},{key:"unit",label:"UOM",render:x=>x.unit||"—"},{key:"size",label:"Size",render:x=>x.size||"—"},{key:"grade",label:"Grade",render:x=>x.grade||"—"},{key:"cost",label:"Cost",className:"text-right",render:x=>Number(x.cost||0).toLocaleString()},{key:"price",label:"Sale Price",className:"text-right",render:x=>Number(x.price||0).toLocaleString()},{key:"status",label:"Status",render:x=><span className={`rounded-full px-2 py-1 text-xs font-semibold ${x.is_active?"bg-emerald-50 text-emerald-700":"bg-slate-100 text-slate-600"}`}>{x.is_active?"Active":"Inactive"}</span>},{key:"actions",label:"Actions",className:"text-right",render:x=><div className="flex justify-end gap-2"><button className="btn-secondary inline-flex items-center gap-1 px-2 py-1 text-xs" onClick={()=>editItem(x)}><Pencil className="h-3.5 w-3.5"/>Edit</button><MasterActionButton tone="danger" title={x.is_active?"Deactivate Item":"Activate Item"} message="Historical transactions will remain safe. Inactive records cannot be selected for new transactions." onConfirm={()=>toggleStatus(x)} className="btn-secondary inline-flex items-center gap-1 px-2 py-1 text-xs"><Power className="h-3.5 w-3.5"/>{x.is_active?"Deactivate":"Activate"}</MasterActionButton><button className="btn-secondary inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600" onClick={()=>void del(x)}><Trash2 className="h-3.5 w-3.5"/>Delete</button></div>}];
  return <div className="space-y-4" data-navilo-master-standard="true">
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-no-print data-no-export>
      <div className="grid gap-0 lg:grid-cols-[1.8fr_repeat(4,minmax(0,1fr))]">
        <div className="flex items-center gap-4 p-5">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-600"><Package className="h-7 w-7"/></div>
          <div><h1 className="text-2xl font-bold tracking-tight text-slate-900">Items</h1><p className="mt-1 text-sm text-slate-500">Manage your item master data</p></div>
        </div>
        <div className="flex items-center gap-3 border-t border-slate-100 p-4 lg:border-l lg:border-t-0"><div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-600"><Package className="h-5 w-5"/></div><div><p className="text-xs font-medium text-slate-500">Total Items</p><p className="text-xl font-bold text-slate-900">{items.length.toLocaleString()}</p></div></div>
        <div className="flex items-center gap-3 border-t border-slate-100 p-4 lg:border-l lg:border-t-0"><div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-5 w-5"/></div><div><p className="text-xs font-medium text-slate-500">Active Items</p><p className="text-xl font-bold text-slate-900">{activeCount.toLocaleString()}</p></div></div>
        <div className="flex items-center gap-3 border-t border-slate-100 p-4 lg:border-l lg:border-t-0"><div className="grid h-10 w-10 place-items-center rounded-xl bg-red-50 text-red-600"><XCircle className="h-5 w-5"/></div><div><p className="text-xs font-medium text-slate-500">Inactive Items</p><p className="text-xl font-bold text-slate-900">{inactiveCount.toLocaleString()}</p></div></div>
        <div className="flex items-center gap-3 border-t border-slate-100 p-4 lg:border-l lg:border-t-0"><div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600"><Layers3 className="h-5 w-5"/></div><div><p className="text-xs font-medium text-slate-500">Categories</p><p className="text-xl font-bold text-slate-900">{categories.length.toLocaleString()}</p></div></div>
      </div>
    </section>

    {error&&<div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" data-no-print data-no-export>{error}</div>}

    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm" data-no-print data-no-export>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[260px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by item, category, HS/PCT, UOM..."/></label>
        <SearchableSelect className="input !h-10 !w-auto min-w-[125px]" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">All Status</option><option value="active">Active</option><option value="inactive">Inactive</option></SearchableSelect>
        <SearchableSelect className="input !h-10 !w-auto min-w-[145px]" value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}><option value="all">All Categories</option>{categories.map(c=><option key={c.id} value={c.id}>{masterLabel(c.name,c.name_urdu)}</option>)}</SearchableSelect>
        <SearchableSelect className="input !h-10 !w-auto min-w-[115px]" value={uomFilter} onChange={e=>setUomFilter(e.target.value)}><option value="all">All UOM</option>{uoms.map(u=><option key={u.id} value={u.symbol}>{masterLabel(u.name,u.name_urdu,u.symbol)}</option>)}</SearchableSelect>
        <SearchableSelect className="input !h-10 !w-auto min-w-[120px]" value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}><option value="all">All Types</option><option value="raw">Raw</option><option value="component">Component</option><option value="finished">Finished</option></SearchableSelect>
        {(search||typeFilter!=="all"||categoryFilter!=="all"||statusFilter!=="all"||uomFilter!=="all")&&<button type="button" className="btn-secondary !h-10 px-3" onClick={()=>{setSearch("");clearFilters()}}>Clear</button>}
        <button type="button" className="btn-primary !h-10 whitespace-nowrap px-4" onClick={()=>void start()}><Plus className="h-4 w-4"/>Add Item</button>
      </div>
    </section>

    <div data-report-content data-navilo-customizable="true" data-navilo-print-surface className="contents"><DataTable showSerialNumber columns={tableCols} rows={shown} /></div>

    

    {open&&<div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4" data-no-print data-no-export><form onSubmit={save} className="max-h-[90vh] w-full max-w-2xl space-y-3 overflow-visible rounded-xl bg-white p-6 shadow-xl"><h2 className="text-lg font-bold">{edit?"Edit Item":"Add Item"}</h2><div className="grid gap-3 sm:grid-cols-2">
      
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
