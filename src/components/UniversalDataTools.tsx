import { useEffect, useRef, useState } from "react";
import { Download, FileText, Languages, Printer, Sheet, Table2 } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { hasPermission, type ModuleKey } from "@/auth/permissions";
import { exportDomReportToCSV, exportDomReportToExcel, exportDomReportToWord, triggerPrint } from "@/lib/exportUtils";
import UserLanguagePreference from "@/components/UserLanguagePreference";

function cleanTitle(value: string) { return value.replace(/\s*\/\s*[\u0600-\u06FF].*$/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "navilo-export"; }
function currentPageTitle() { const root=document.querySelector<HTMLElement>("[data-report-content]")||document.querySelector<HTMLElement>("#navilo-main-content")||document.body;return root.querySelector<HTMLElement>("h1,h2,.page-title")?.textContent?.replace(/\s+/g," ").trim()||document.title||"NAVILO"; }
function currentExportRoot() { return document.querySelector<HTMLElement>("[data-report-content]") || document.querySelector<HTMLElement>("#navilo-main-content"); }
function normalizeActionLabel(value:string){return value.replace(/\s+/g," ").replace(/\.(xlsx|xls|csv|docx|doc|pdf)\b/gi,"").replace(/[()]/g,"").trim().toLowerCase();}
function moduleForPath(pathname:string):ModuleKey{
  if(pathname==="/")return "dashboard";
  if(pathname.startsWith("/sales/report"))return "reports";
  if(pathname.startsWith("/sales/charges"))return "master";
  if(pathname.startsWith("/sales"))return "sales";
  if(pathname.startsWith("/purchase"))return "purchase";
  if(pathname.startsWith("/master-data"))return "master";
  if(pathname.startsWith("/godown"))return "inventory";
  if(pathname.startsWith("/production")||pathname.startsWith("/cutting"))return "production";
  if(pathname.startsWith("/transport"))return "transport";
  if(pathname.startsWith("/reports"))return "reports";
  if(pathname.startsWith("/accounting"))return "accounting";
  if(pathname.startsWith("/settings"))return "settings";
  return "dashboard";
}
const duplicateGenericActions=new Set(["export","export excel","export csv","export word","excel","csv","word","pdf","print","print pdf","print / pdf","pdf / print","download excel","download csv","download word"]);

/** Global language + permission-aware export / print surface for the protected ERP workspace. */
export default function UniversalDataTools() {
  const { pathname } = useLocation();
  const {activeCompany,activeBusinessUnit,isPlatformOwner}=useAuth();
  const [open,setOpen]=useState(false),[languageOpen,setLanguageOpen]=useState(false);const ref=useRef<HTMLDivElement|null>(null);const journalList=pathname==="/accounting";
  const role=activeBusinessUnit?.membership_role??activeCompany?.membership_role;
  const module=moduleForPath(pathname);
  const permissions=activeBusinessUnit?.permissions??activeCompany?.permissions;
  const canExport=isPlatformOwner||hasPermission(role,module,"export",permissions,false);
  const canPrint=isPlatformOwner||hasPermission(role,module,"print",permissions,false);

  useEffect(()=>{const main=document.querySelector<HTMLElement>("#navilo-main-content");if(!main)return;const suppress=()=>{main.querySelectorAll<HTMLElement>("button,a,[role='button']").forEach(element=>{if(element.closest("[data-navilo-global-data-tools]"))return;if(element.dataset.naviloKeepLocalAction==="true")return;const label=normalizeActionLabel(element.textContent||element.getAttribute("aria-label")||element.getAttribute("title")||"");if(!duplicateGenericActions.has(label))return;element.style.display="none";element.dataset.naviloDuplicateGlobalAction="true";});};suppress();const observer=new MutationObserver(suppress);observer.observe(main,{childList:true,subtree:true,characterData:true});return()=>observer.disconnect();},[pathname]);

  useEffect(()=>{if(!journalList)return;const style=document.createElement("style");style.dataset.naviloJournalToolbar="true";style.textContent='button[title^="Print journal voucher"]{display:none!important}';document.head.appendChild(style);const normalizeImportArrow=()=>{Array.from(document.querySelectorAll<HTMLButtonElement>("#navilo-main-content button")).forEach(button=>{const walker=document.createTreeWalker(button,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode as Text;if(node.nodeValue?.includes("↓ Bulk Import")){node.nodeValue=node.nodeValue.replace("↓ Bulk Import","↑ Bulk Import");break;}}});};normalizeImportArrow();const observer=new MutationObserver(normalizeImportArrow);const main=document.querySelector("#navilo-main-content");if(main)observer.observe(main,{childList:true,subtree:true,characterData:true});return()=>{observer.disconnect();style.remove();};},[journalList]);

  useEffect(()=>{if(!open&&!languageOpen)return;const close=(event:MouseEvent)=>{if(ref.current&&!ref.current.contains(event.target as Node)){setOpen(false);setLanguageOpen(false);}};document.addEventListener("mousedown",close);return()=>document.removeEventListener("mousedown",close);},[open,languageOpen]);

  const exportCurrent=(type:"excel"|"csv"|"word")=>{if(!canExport)return;const root=currentExportRoot();if(!root)return;const title=currentPageTitle(),filename=cleanTitle(title);if(type==="excel")exportDomReportToExcel(filename,root,title);if(type==="csv")exportDomReportToCSV(filename,root,title);if(type==="word")exportDomReportToWord(filename,root,title);setOpen(false);};
  const printCurrent=()=>{if(!canPrint)return;setOpen(false);triggerPrint(document.querySelector("[data-report-content]")?"[data-report-content]":"#navilo-main-content");};

  return <div className="relative flex items-center gap-2" ref={ref} data-no-print data-no-export data-navilo-global-data-tools>
    <div className="relative"><button type="button" onClick={()=>{setLanguageOpen(v=>!v);setOpen(false);}} className="inline-flex h-9 items-center gap-2 rounded-md border border-violet-300 bg-violet-50 px-3 text-[12px] font-bold text-violet-800 shadow-sm hover:bg-violet-100" aria-haspopup="dialog" aria-expanded={languageOpen} title="My screen language"><Languages className="h-4 w-4"/><span className="hidden xl:inline">Language</span></button>{languageOpen&&<div className="absolute right-0 top-11 z-[80] w-[min(92vw,520px)] rounded-xl border border-slate-200 bg-white p-2 shadow-2xl" role="dialog" aria-label="My language preference"><UserLanguagePreference/></div>}</div>
    {canExport&&<div className="relative"><button type="button" onClick={()=>{setOpen(v=>!v);setLanguageOpen(false);}} className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-bold text-slate-700 shadow-sm hover:bg-slate-50" aria-haspopup="menu" aria-expanded={open} title="Export current ERP screen"><Download className="h-4 w-4"/><span className="hidden xl:inline">Export</span></button>{open&&<div className="absolute right-0 top-11 z-[70] w-48 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl" role="menu"><button type="button" onClick={()=>exportCurrent("excel")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"><Sheet className="h-4 w-4"/>Excel (.xlsx)</button><button type="button" onClick={()=>exportCurrent("csv")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"><Table2 className="h-4 w-4"/>CSV (.csv)</button><button type="button" onClick={()=>exportCurrent("word")} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"><FileText className="h-4 w-4"/>Word (.doc)</button></div>}</div>}
    {canPrint&&<button type="button" onClick={printCurrent} className="inline-flex h-9 items-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-3 text-[12px] font-bold text-blue-800 shadow-sm hover:bg-blue-100" title="Print preview or save as PDF"><Printer className="h-4 w-4"/><span className="hidden xl:inline">Print / PDF</span></button>}
  </div>;
}
