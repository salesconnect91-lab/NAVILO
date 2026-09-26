import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";

const NON_SEARCH_ROUTES=[/^\/sales\/(new|[^/]+\/edit)$/, /^\/purchase\/new$/, /^\/settings(?:\/|$)/, /^\/owner(?:\/|$)/];
function isSearchableRoute(pathname:string){return !NON_SEARCH_ROUTES.some(rule=>rule.test(pathname))}
function hasNativeSearch(root:HTMLElement|null){return Boolean(root?.querySelector('.navilo-master-filterbar input,input[type="search"],input[placeholder*="Search" i]'))}
function searchableRows(root:HTMLElement){return Array.from(root.querySelectorAll<HTMLElement>('tbody tr,[data-neus-search-row]')).filter(node=>!node.closest('[data-no-export]'))}
type GenericColumn={index:number;label:string};

export default function NeusRouteSurface(){
 const{pathname}=useLocation(),[query,setQuery]=useState(""),[native,setNative]=useState(false);
 const[customizeOpen,setCustomizeOpen]=useState(false),[genericColumns,setGenericColumns]=useState<GenericColumn[]>([]),[hidden,setHidden]=useState<Set<number>>(new Set());
 const enabled=useMemo(()=>isSearchableRoute(pathname),[pathname]);
 useEffect(()=>{setQuery("");setCustomizeOpen(false)},[pathname]);
 useEffect(()=>{const root=document.querySelector<HTMLElement>("#navilo-main-content");if(!root||!enabled){setNative(false);return}const inspect=()=>setNative(hasNativeSearch(root));inspect();const observer=new MutationObserver(inspect);observer.observe(root,{childList:true,subtree:true});return()=>observer.disconnect()},[pathname,enabled]);
 useEffect(()=>{const root=document.querySelector<HTMLElement>("#navilo-main-content");if(!root||!enabled||native)return;const apply=()=>{const q=query.trim().toLocaleLowerCase();searchableRows(root).forEach(row=>{const hit=!q||(row.textContent??"").toLocaleLowerCase().includes(q);row.dataset.neusSearchHidden=hit?"false":"true";row.style.display=hit?"":"none"})};apply();const observer=new MutationObserver(apply);observer.observe(root,{childList:true,subtree:true,characterData:true});return()=>{observer.disconnect();searchableRows(root).forEach(row=>{row.style.display="";delete row.dataset.neusSearchHidden})}},[query,pathname,enabled,native]);

 useEffect(()=>{
  const open=()=>{
   const root=document.querySelector<HTMLElement>("#navilo-main-content"); if(!root)return;
   if(root.querySelector("[data-navilo-data-table],[data-neus-native-customizer]"))return;
   const table=root.querySelector<HTMLTableElement>("[data-navilo-customizable='true'] table,[data-report-content] table");if(!table)return;
   const heads=Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"));
   const cols=heads.map((th,index)=>({index,label:(th.textContent||`Column ${index+1}`).trim()||`Column ${index+1}`})).filter(c=>!heads[c.index].hasAttribute("data-no-export")&&c.label.toLowerCase()!=="actions");
   const key=`navilo:neus-columns:${pathname}`;let saved:number[]=[];try{saved=JSON.parse(localStorage.getItem(key)||"[]")}catch{}
   setGenericColumns(cols);setHidden(new Set(saved));setCustomizeOpen(true);
  };
  window.addEventListener("navilo:report-customize",open);return()=>window.removeEventListener("navilo:report-customize",open);
 },[pathname]);

 useEffect(()=>{
  const root=document.querySelector<HTMLElement>("#navilo-main-content");const table=root?.querySelector<HTMLTableElement>("[data-navilo-customizable='true'] table,[data-report-content] table");if(!table)return;
  Array.from(table.rows).forEach(row=>Array.from(row.cells).forEach((cell,index)=>{if(genericColumns.some(c=>c.index===index))cell.style.display=hidden.has(index)?"none":""}));
  if(genericColumns.length){try{localStorage.setItem(`navilo:neus-columns:${pathname}`,JSON.stringify([...hidden]))}catch{}}
 },[hidden,genericColumns,pathname]);

 const setAll=(show:boolean)=>{if(show)setHidden(new Set());else{const keep=genericColumns[0]?.index;setHidden(new Set(genericColumns.filter(c=>c.index!==keep).map(c=>c.index)))}};
 const toggle=(index:number)=>setHidden(current=>{const next=new Set(current);if(next.has(index))next.delete(index);else if(genericColumns.filter(c=>!next.has(c.index)).length>1)next.add(index);return next});

 return <>
  {enabled&&!native&&<div data-neus-search data-no-print data-no-export className="neus-route-search mb-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm"><Search className="h-4 w-4 shrink-0 text-slate-400"/><input value={query} onChange={e=>setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Search this screen…"/>{query&&<button type="button" onClick={()=>setQuery("")} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-bold text-blue-700 hover:bg-blue-50"><X className="h-3.5 w-3.5"/>Clear</button>}</div>}
  {customizeOpen&&<div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/35 p-4" data-no-print data-no-export><div className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-xl border bg-white shadow-2xl"><div className="flex items-start justify-between border-b p-5"><div><h3 className="font-bold">Customize Columns</h3><p className="mt-1 text-xs text-slate-500">Screen, Export and Print/PDF use the same visible columns.</p></div><button className="btn-secondary" onClick={()=>setCustomizeOpen(false)}>Close</button></div><div className="flex items-center justify-between border-b px-5 py-3"><span className="text-xs font-semibold text-slate-500">{genericColumns.filter(c=>!hidden.has(c.index)).length} selected</span><div className="flex gap-2"><button className="btn-secondary" onClick={()=>setAll(true)}>Select All</button><button className="btn-secondary" onClick={()=>setAll(false)}>Clear All</button></div></div><div className="min-h-0 flex-1 overflow-y-auto p-5">{genericColumns.map(c=><label key={c.index} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-slate-50"><input type="checkbox" checked={!hidden.has(c.index)} onChange={()=>toggle(c.index)}/><span className="text-sm">{c.label}</span></label>)}</div><div className="flex justify-between border-t p-5"><button className="btn-secondary" onClick={()=>{try{localStorage.removeItem(`navilo:neus-columns:${pathname}`)}catch{};setHidden(new Set())}}>Reset Default</button><button className="btn-primary" onClick={()=>setCustomizeOpen(false)}>Done</button></div></div></div>}
 </>;
}
