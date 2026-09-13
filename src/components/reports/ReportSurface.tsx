import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { loadDocumentPrintSettings } from "@/lib/documentPrintSettings";

type ReportSurfaceProps = { children: ReactNode };
type ColumnChoice = { index: number; label: string; visible: boolean };
type Density = "compact" | "standard";
type Orientation = "portrait" | "landscape";
type SavedPrefs = { hiddenLabels?: string[]; density?: Density; orientation?: Orientation; showTotals?: boolean; showFilters?: boolean };

const duplicateLabels = ["export","export excel","export csv","export word","excel","csv","word","pdf","print","print pdf","print / pdf","pdf / print","download excel","download csv","download word","customize columns","print options"];
const normalize = (value:string) => value.replace(/\s+/g," ").replace(/\.(xlsx|xls|csv|docx|doc|pdf)\b/gi,"").replace(/[()]/g,"").trim().toLowerCase();

export default function ReportSurface({ children }: ReportSurfaceProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<ColumnChoice[]>([]);
  const [density, setDensity] = useState<Density>("compact");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [showTotals, setShowTotals] = useState(true);
  const [showFilters, setShowFilters] = useState(true);
  const storageKey = useMemo(() => `navilo:report-prefs:${window.location.pathname}`, []);

  useEffect(() => { void loadDocumentPrintSettings("reports").catch(() => undefined); try { const saved=JSON.parse(localStorage.getItem(storageKey)||"{}") as SavedPrefs; if(saved.density)setDensity(saved.density);if(saved.orientation)setOrientation(saved.orientation);if(typeof saved.showTotals==="boolean")setShowTotals(saved.showTotals);if(typeof saved.showFilters==="boolean")setShowFilters(saved.showFilters);} catch{/* ignore */} }, [storageKey]);
  const reportContent=useCallback(()=>rootRef.current?.querySelector<HTMLElement>("[data-report-content]")??rootRef.current,[]);
  const savedHiddenLabels=useCallback(()=>{try{return new Set(((JSON.parse(localStorage.getItem(storageKey)||"{}") as SavedPrefs).hiddenLabels||[]))}catch{return new Set<string>()}},[storageKey]);
  const scanColumns=useCallback(()=>{const root=reportContent(),table=root?.querySelector("table");if(!table){setColumns([]);return}const hidden=savedHiddenLabels(),headers=Array.from(table.querySelectorAll("thead th"));setColumns(prev=>headers.map((cell,index)=>{const label=(cell.textContent||`Column ${index+1}`).trim(),existing=prev.find(item=>item.label===label);return{index,label,visible:existing?.visible??!hidden.has(label)}}))},[reportContent,savedHiddenLabels]);
  useEffect(()=>{scanColumns();const root=reportContent();if(!root)return;const observer=new MutationObserver(scanColumns);observer.observe(root,{childList:true,subtree:true});return()=>observer.disconnect()},[reportContent,scanColumns]);
  useEffect(()=>{const root=reportContent();if(!root)return;const hide=()=>root.querySelectorAll<HTMLElement>("button,a,[role='button']").forEach(el=>{if(el.dataset.naviloKeepLocalAction==="true")return;const label=normalize(el.textContent||el.getAttribute("aria-label")||el.getAttribute("title")||"");if(duplicateLabels.includes(label)){el.style.display="none";el.dataset.naviloDuplicateReportAction="true"}});hide();const observer=new MutationObserver(hide);observer.observe(root,{childList:true,subtree:true,characterData:true});return()=>observer.disconnect()},[reportContent]);
  useEffect(()=>{const root=reportContent();if(!root)return;const hidden=new Set(columns.filter(c=>!c.visible).map(c=>c.index));root.querySelectorAll("table").forEach(table=>table.querySelectorAll("tr").forEach(row=>Array.from(row.children).forEach((cell,index)=>{(cell as HTMLElement).style.display=hidden.has(index)?"none":""})));root.querySelectorAll<HTMLElement>("tfoot,[data-report-total],.report-total-row").forEach(el=>{el.style.display=showTotals?"":"none"});root.querySelectorAll<HTMLElement>("[data-report-filters]").forEach(el=>{el.style.display=showFilters?"":"none"});root.dataset.reportDensity=density;root.dataset.reportOrientation=orientation;try{localStorage.setItem(storageKey,JSON.stringify({hiddenLabels:columns.filter(c=>!c.visible).map(c=>c.label),density,orientation,showTotals,showFilters} satisfies SavedPrefs))}catch{/* ignore */}},[columns,density,orientation,reportContent,showFilters,showTotals,storageKey]);

  return <div ref={rootRef} className="professional-report print-report" data-report-root>
    <style>{`[data-report-content][data-report-density="compact"] table th,[data-report-content][data-report-density="compact"] table td{padding-top:4px!important;padding-bottom:4px!important;font-size:11px!important}@media print{@page{size:A4 ${orientation};margin:10mm}[data-report-content][data-report-density="compact"] table th,[data-report-content][data-report-density="compact"] table td{padding:3px 5px!important;font-size:9.5px!important}}`}</style>
    <div data-report-content className="report-print-content" data-report-density={density} data-report-orientation={orientation}>{children}</div>
    <div className="hidden" aria-hidden="true"><X/><span>{columns.length}{showTotals?" totals":""}{showFilters?" filters":""}</span></div>
  </div>;
}
