import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Columns3, X } from "lucide-react";
import { loadDocumentPrintSettings } from "@/lib/documentPrintSettings";

type ReportSurfaceProps = { children: ReactNode };
type ColumnChoice = { index: number; label: string; visible: boolean };
type Density = "compact" | "standard";
type Orientation = "portrait" | "landscape";
type SavedPrefs = { hiddenLabels?: string[]; density?: Density; orientation?: Orientation; showTotals?: boolean; showFilters?: boolean };

const normalize = (value:string) => value.replace(/\s+/g," ").replace(/\.(xlsx|xls|csv|docx|doc|pdf)\b/gi,"").replace(/[()]/g,"").trim().toLowerCase();
const isDuplicateAction = (label:string) => {
  const v=normalize(label);
  return v.includes("export")||v.includes("download excel")||v.includes("download csv")||v.includes("download word")||v==="excel"||v==="csv"||v==="word"||v.includes("print")||v==="pdf"||v.startsWith("pdf /")||v.includes("customize columns")||v.includes("print options");
};

export default function ReportSurface({ children }: ReportSurfaceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<ColumnChoice[]>([]);
  const [density, setDensity] = useState<Density>("compact");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [showTotals, setShowTotals] = useState(true);
  const [showFilters, setShowFilters] = useState(true);
  const [customizeOpen,setCustomizeOpen]=useState(false);
  const storageKey = useMemo(() => `navilo:report-prefs:${window.location.pathname}`, []);

  useEffect(() => { void loadDocumentPrintSettings("reports").catch(() => undefined); try { const saved=JSON.parse(localStorage.getItem(storageKey)||"{}") as SavedPrefs; if(saved.density)setDensity(saved.density);if(saved.orientation)setOrientation(saved.orientation);if(typeof saved.showTotals==="boolean")setShowTotals(saved.showTotals);if(typeof saved.showFilters==="boolean")setShowFilters(saved.showFilters);} catch{/* ignore */} }, [storageKey]);
  const reportContent=useCallback(()=>rootRef.current?.querySelector<HTMLElement>(".navilo-report-source")??rootRef.current,[]);
  const savedHiddenLabels=useCallback(()=>{try{return new Set(((JSON.parse(localStorage.getItem(storageKey)||"{}") as SavedPrefs).hiddenLabels||[]))}catch{return new Set<string>()}},[storageKey]);

  const scan=useCallback(()=>{
    const root=reportContent(); if(!root)return;
    const table=root.querySelector("table"); if(!table){setColumns([]);return}
    const hidden=savedHiddenLabels(),headers=Array.from(table.querySelectorAll("thead th"));
    setColumns(prev=>headers.map((cell,index)=>{const label=(cell.textContent||`Column ${index+1}`).trim(),existing=prev.find(item=>item.label===label);return{index,label,visible:existing?.visible??!hidden.has(label)}}));
  },[reportContent,savedHiddenLabels]);

  useEffect(()=>{scan();const root=reportContent();if(!root)return;const observer=new MutationObserver(scan);observer.observe(root,{childList:true,subtree:true,characterData:true});return()=>observer.disconnect()},[reportContent,scan]);
  useEffect(()=>{const onCustomize=()=>setCustomizeOpen(v=>!v);window.addEventListener("navilo:report-customize",onCustomize);return()=>window.removeEventListener("navilo:report-customize",onCustomize)},[]);
  useEffect(()=>{const root=reportContent();if(!root)return;const hide=()=>root.querySelectorAll<HTMLElement>("button,a,[role='button']").forEach(el=>{if(el.dataset.naviloKeepLocalAction==="true")return;const label=el.textContent||el.getAttribute("aria-label")||el.getAttribute("title")||"";if(isDuplicateAction(label)){el.style.setProperty("display","none","important");el.dataset.naviloDuplicateReportAction="true"}});hide();const observer=new MutationObserver(hide);observer.observe(root,{childList:true,subtree:true,characterData:true});return()=>observer.disconnect()},[reportContent]);
  useEffect(()=>{const root=reportContent();if(!root)return;const hidden=new Set(columns.filter(c=>!c.visible).map(c=>c.index));root.querySelectorAll("table").forEach(table=>table.querySelectorAll("tr").forEach(row=>Array.from(row.children).forEach((cell,index)=>{(cell as HTMLElement).style.display=hidden.has(index)?"none":""})));root.querySelectorAll<HTMLElement>("tfoot,[data-report-total],.report-total-row").forEach(el=>{el.style.display=showTotals?"":"none"});root.querySelectorAll<HTMLElement>("[data-report-filters]").forEach(el=>{el.style.display=showFilters?"":"none"});try{localStorage.setItem(storageKey,JSON.stringify({hiddenLabels:columns.filter(c=>!c.visible).map(c=>c.label),density,orientation,showTotals,showFilters} satisfies SavedPrefs))}catch{/* ignore */}},[columns,density,orientation,reportContent,showFilters,showTotals,storageKey]);

  const reset=()=>{setColumns(list=>list.map(item=>({...item,visible:true})));setDensity("compact");setOrientation("landscape");setShowTotals(true);setShowFilters(true)};

  return <div ref={rootRef} className="professional-report print-report" data-report-root>
    <style>{`@media print{@page{size:A4 ${orientation};margin:10mm}}`}</style>
    <div data-report-content className="report-print-content" data-report-density={density} data-report-orientation={orientation}>
      <div className="navilo-report-source">{children}</div>
    </div>
    {customizeOpen&&<div className="navilo-report-customizer no-print" data-no-print data-no-export>
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3"><div><div className="text-sm font-bold">Customize Report</div><div className="text-[11px] text-slate-500">Display and print options</div></div><button type="button" aria-label="Close customize report" onClick={()=>setCustomizeOpen(false)}><X className="h-4 w-4"/></button></div>
      <div className="space-y-4 p-4 text-xs">
        {columns.length>0&&<div><div className="mb-2 flex items-center gap-2 font-bold"><Columns3 className="h-4 w-4"/>Columns</div><div className="max-h-52 space-y-1 overflow-y-auto">{columns.map(c=><label key={`${c.index}-${c.label}`} className="flex items-center gap-2 py-1"><input type="checkbox" checked={c.visible} onChange={()=>setColumns(list=>list.map(item=>item.index===c.index?{...item,visible:!item.visible}:item))}/><span>{c.label}</span></label>)}</div></div>}
        <label className="block font-semibold">Density<select className="input mt-1 w-full" value={density} onChange={e=>setDensity(e.target.value as Density)}><option value="compact">Compact</option><option value="standard">Standard</option></select></label>
        <label className="block font-semibold">Print orientation<select className="input mt-1 w-full" value={orientation} onChange={e=>setOrientation(e.target.value as Orientation)}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={showTotals} onChange={e=>setShowTotals(e.target.checked)}/>Show totals</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={showFilters} onChange={e=>setShowFilters(e.target.checked)}/>Show filters</label>
        <button type="button" className="btn-secondary w-full" onClick={reset}>Reset report view</button>
      </div>
    </div>}
  </div>;
}
