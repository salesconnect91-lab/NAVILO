import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";

const NON_SEARCH_ROUTES=[/^\/sales\/(new|[^/]+\/edit)$/, /^\/purchase\/new$/, /^\/settings(?:\/|$)/, /^\/owner(?:\/|$)/];
function isSearchableRoute(pathname:string){return !NON_SEARCH_ROUTES.some(rule=>rule.test(pathname))}
function hasNativeSearch(root:HTMLElement|null){return Boolean(root?.querySelector('[data-neus-search],.navilo-master-filterbar input,input[type="search"],input[placeholder*="Search" i]'))}
function searchableRows(root:HTMLElement){return Array.from(root.querySelectorAll<HTMLElement>('tbody tr,[data-neus-search-row]')).filter(node=>!node.closest('[data-no-export]'))}

export default function NeusRouteSurface(){
 const{pathname}=useLocation(),[query,setQuery]=useState(""),[native,setNative]=useState(false);
 const enabled=useMemo(()=>isSearchableRoute(pathname),[pathname]);
 useEffect(()=>{setQuery("")},[pathname]);
 useEffect(()=>{const root=document.querySelector<HTMLElement>("#navilo-main-content");if(!root||!enabled){setNative(false);return}const inspect=()=>setNative(hasNativeSearch(root));inspect();const observer=new MutationObserver(inspect);observer.observe(root,{childList:true,subtree:true});return()=>observer.disconnect()},[pathname,enabled]);
 useEffect(()=>{const root=document.querySelector<HTMLElement>("#navilo-main-content");if(!root||!enabled||native)return;const apply=()=>{const q=query.trim().toLocaleLowerCase();searchableRows(root).forEach(row=>{const hit=!q||(row.textContent??"").toLocaleLowerCase().includes(q);row.dataset.neusSearchHidden=hit?"false":"true";row.style.display=hit?"":"none"})};apply();const observer=new MutationObserver(apply);observer.observe(root,{childList:true,subtree:true,characterData:true});return()=>{observer.disconnect();searchableRows(root).forEach(row=>{row.style.display="";delete row.dataset.neusSearchHidden})}},[query,pathname,enabled,native]);
 if(!enabled||native)return null;
 return <div data-neus-search data-no-print data-no-export className="neus-route-search mb-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm"><Search className="h-4 w-4 shrink-0 text-slate-400"/><input value={query} onChange={e=>setQuery(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Search this screen…"/>{query&&<button type="button" onClick={()=>setQuery("")} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-bold text-blue-700 hover:bg-blue-50"><X className="h-3.5 w-3.5"/>Clear</button>}</div>
}
