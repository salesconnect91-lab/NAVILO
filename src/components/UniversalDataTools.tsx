import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, Printer, Settings2, Sheet, Table2, Upload } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { hasPermission, type ModuleKey } from "@/auth/permissions";
import { exportDomReportToCSV, exportDomReportToExcel, exportDomReportToWord, triggerPrint } from "@/lib/exportUtils";

function cleanTitle(v:string){return v.replace(/\s*\/\s*[\u0600-\u06FF].*$/,"").replace(/[^a-z0-9]+/gi,"-").replace(/^-+|-+$/g,"").toLowerCase()||"navilo-export"}
function reportRoot(){return document.querySelector<HTMLElement>("[data-report-content]")||document.querySelector<HTMLElement>(".professional-report")||document.querySelector<HTMLElement>("#order-book-report")||document.querySelector<HTMLElement>("#navilo-main-content")}
function reportSelector(){if(document.querySelector("[data-report-content]"))return"[data-report-content]";if(document.querySelector(".professional-report"))return".professional-report";if(document.querySelector("#order-book-report"))return"#order-book-report";return"#navilo-main-content"}
function currentPageTitle(){const r=reportRoot()||document.body;return r.querySelector<HTMLElement>(".navilo-report-title,h1,h2,.page-title")?.textContent?.replace(/\s+/g," ").trim()||document.title||"NAVILO"}
function currentExportRoot(){return reportRoot()}
function normalize(v:string){return v.replace(/\s+/g," ").replace(/\.(xlsx|xls|csv|docx|doc|pdf)\b/gi,"").replace(/[()]/g,"").trim().toLowerCase()}
function moduleForPath(p:string):ModuleKey{if(p==="/")return"dashboard";if(p.startsWith("/sales/report"))return"reports";if(p.startsWith("/sales/charges"))return"master";if(p.startsWith("/sales"))return"sales";if(p.startsWith("/purchase"))return"purchase";if(p.startsWith("/master-data"))return"master";if(p.startsWith("/godown"))return"inventory";if(p.startsWith("/production")||p.startsWith("/cutting"))return"production";if(p.startsWith("/transport"))return"transport";if(p.startsWith("/reports"))return"reports";if(p.startsWith("/accounting"))return"accounting";if(p.startsWith("/settings"))return"settings";return"dashboard"}
function isReportPath(p:string){if(p.startsWith("/reports")||p.startsWith("/sales/report")||p==="/sales/person-ledger")return true;if(!p.startsWith("/accounting/"))return false;return ["/accounting/vat-register","/accounting/day-book","/accounting/ledgers","/accounting/payroll","/accounting/loans","/accounting/bank-reconciliation","/accounting/trial-balance","/accounting/profit-loss","/accounting/balance-sheet","/accounting/cash-flow","/accounting/controls","/accounting/audit-trail","/accounting/customer-invoice-statement"].some(x=>p===x||p.startsWith(`${x}/`))}
function isMasterStandardPath(p:string){return p==="/master-data"||p.startsWith("/master-data/")||p==="/sales/charges"||p.startsWith("/sales/charges/")}
function isNaviloStandardPath(p:string){if(isMasterStandardPath(p)||isReportPath(p))return true;return ["/sales","/purchase","/godown","/production","/cutting","/accounting","/reports","/transport","/orders"].some(x=>p===x||p.startsWith(`${x}/`))}
function isExportDuplicate(v:string){const x=normalize(v);return x.includes("export")||x.includes("download excel")||x.includes("download csv")||x.includes("download word")||x==="excel"||x==="csv"||x==="word"||x.includes("print")||x==="pdf"||x.startsWith("pdf /")||x.includes("customize columns")||x.includes("print options")}
function isTemplateAction(v:string){const x=normalize(v);return x.includes("template")}
function isUploadAction(v:string){const x=normalize(v);return x==="import"||x.includes("bulk upload")||x.includes("choose file")||x.includes("upload csv")||x.includes("upload file")}
function isPrimaryAction(v:string){const x=normalize(v);return /^(\+\s*)?(add|new|create)\s+(item|category|customer|supplier|employee|warehouse|godown|uom|unit|transporter|charge|invoice|sales invoice|purchase invoice|order|sales order|purchase order|work order|cutting order|gate pass|receipt|payment|journal|journal entry|voucher)/.test(x)}
function findLocalAction(predicate:(label:string)=>boolean){const main=document.querySelector<HTMLElement>("#navilo-main-content");if(!main)return null;return Array.from(main.querySelectorAll<HTMLElement>("button,a,[role='button']")).find(el=>!el.closest("[data-navilo-global-data-tools]")&&predicate(el.textContent||el.getAttribute("aria-label")||el.getAttribute("title")||""))??null}

export default function UniversalDataTools(){
  const{pathname}=useLocation(),{activeCompany,activeBusinessUnit,isPlatformOwner}=useAuth();
  const[open,setOpen]=useState(false),[importOpen,setImportOpen]=useState(false),[standardHost,setStandardHost]=useState<HTMLElement|null>(null),[hasTemplate,setHasTemplate]=useState(false),[hasUpload,setHasUpload]=useState(false),[hasCustomizableTable,setHasCustomizableTable]=useState(false);
  const ref=useRef<HTMLDivElement|null>(null);
  const reportMode=isReportPath(pathname),masterStandard=isMasterStandardPath(pathname),standardPath=isNaviloStandardPath(pathname),customizable=reportMode||masterStandard||hasCustomizableTable,journalList=pathname==="/accounting";
  const role=activeBusinessUnit?.membership_role??activeCompany?.membership_role,module=moduleForPath(pathname),permissions=activeBusinessUnit?.permissions??activeCompany?.permissions;
  const canExport=isPlatformOwner||hasPermission(role,module,"export",permissions,false),canPrint=isPlatformOwner||hasPermission(role,module,"print",permissions,false);

  useEffect(()=>{const main=document.querySelector<HTMLElement>("#navilo-main-content");if(!main)return;if(reportMode)main.dataset.naviloScreenType="report";else delete main.dataset.naviloScreenType;if(standardPath)main.dataset.naviloStandard="true";else delete main.dataset.naviloStandard;return()=>{delete main.dataset.naviloScreenType;delete main.dataset.naviloStandard}},[reportMode,standardPath,pathname]);
  useEffect(()=>{const main=document.querySelector<HTMLElement>("#navilo-main-content");if(!main||!standardPath){setHasCustomizableTable(false);return;}const scan=()=>setHasCustomizableTable(Boolean(main.querySelector("[data-navilo-data-table],[data-navilo-customizable='true']")));scan();const o=new MutationObserver(scan);o.observe(main,{childList:true,subtree:true});return()=>{o.disconnect();setHasCustomizableTable(false)}},[pathname,standardPath]);
  useEffect(()=>{const main=document.querySelector<HTMLElement>("#navilo-main-content");if(!main||!standardPath)return;const hidden=new Set<HTMLElement>();const scan=()=>{let template=false,upload=false;main.querySelectorAll<HTMLElement>("button,a,[role='button']").forEach(el=>{if(el.closest("[data-navilo-global-data-tools]")||el.dataset.naviloKeepLocalAction==="true"||el.hasAttribute("data-direct-print"))return;const label=el.textContent||el.getAttribute("aria-label")||el.getAttribute("title")||"";if(isTemplateAction(label)){template=true;el.style.setProperty("display","none","important");hidden.add(el);return}if(isUploadAction(label)){upload=true;el.style.setProperty("display","none","important");hidden.add(el);return}if(isExportDuplicate(label)){el.style.setProperty("display","none","important");el.dataset.naviloDuplicateGlobalAction="true";hidden.add(el)}});setHasTemplate(template);setHasUpload(upload)};scan();const o=new MutationObserver(scan);o.observe(main,{childList:true,subtree:true,characterData:true});return()=>{o.disconnect();hidden.forEach(el=>{el.style.removeProperty("display");delete el.dataset.naviloDuplicateGlobalAction});setHasTemplate(false);setHasUpload(false)}},[pathname,standardPath]);
  useEffect(()=>{
    if(!standardPath){setStandardHost(null);return;}
    const attach=()=>{
      const main=document.querySelector<HTMLElement>("#navilo-main-content");if(!main)return false;
      const explicit=main.querySelector<HTMLElement>("[data-navilo-standard-tools-host]");
      if(explicit){setStandardHost(explicit);return true;}
      const primary=Array.from(main.querySelectorAll<HTMLButtonElement>("button")).find(b=>isPrimaryAction(b.textContent||""));
      const actions=primary?.parentElement;if(!actions)return false;
      let host=actions.querySelector<HTMLElement>("[data-navilo-standard-tools-host]");
      if(!host){host=document.createElement("div");host.dataset.naviloStandardToolsHost="true";host.className="contents";actions.prepend(host)}
      setStandardHost(host);return true;
    };
    if(attach())return()=>setStandardHost(null);
    const observer=new MutationObserver(()=>{if(attach())observer.disconnect()});observer.observe(document.body,{childList:true,subtree:true});
    return()=>{observer.disconnect();setStandardHost(null)};
  },[standardPath,pathname]);
  useEffect(()=>{if(!journalList)return;const s=document.createElement("style");s.textContent='button[title^="Print journal voucher"]{display:none!important}';document.head.appendChild(s);return()=>s.remove()},[journalList]);
  useEffect(()=>{if(!open&&!importOpen)return;const close=(e:MouseEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node)){setOpen(false);setImportOpen(false)}};document.addEventListener("mousedown",close);return()=>document.removeEventListener("mousedown",close)},[open,importOpen]);

  const exp=(t:"excel"|"csv"|"word")=>{if(!canExport)return;const root=currentExportRoot();if(!root)return;const title=currentPageTitle(),file=cleanTitle(title);if(t==="excel")exportDomReportToExcel(file,root,title);if(t==="csv")exportDomReportToCSV(file,root,title);if(t==="word")exportDomReportToWord(file,root,title);setOpen(false)};
  const print=()=>{if(canPrint){setOpen(false);triggerPrint(reportSelector())}};
  const runTemplate=()=>{findLocalAction(isTemplateAction)?.click();setImportOpen(false)};
  const runUpload=()=>{findLocalAction(isUploadAction)?.click();setImportOpen(false)};
  const base=reportMode?"navilo-report-tool":"inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-bold text-slate-700 shadow-sm hover:bg-slate-50";
  const toolbar=<div className={reportMode?"navilo-report-toolbar":"relative flex items-center gap-2"} ref={ref} data-no-print data-no-export data-navilo-global-data-tools>
    {customizable&&<button type="button" onClick={()=>window.dispatchEvent(new Event("navilo:report-customize"))} className={base}><Settings2 className="h-4 w-4"/><span>Customize</span></button>}
    {(hasTemplate||hasUpload)&&<div className="relative"><button type="button" onClick={()=>{setImportOpen(v=>!v);setOpen(false)}} className={base}><Upload className="h-4 w-4"/><span>Import</span></button>{importOpen&&<div className="absolute right-0 top-10 z-[75] w-52 rounded-lg border bg-white py-1 shadow-xl">{hasTemplate&&<button type="button" onClick={runTemplate} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50"><FileText className="h-4 w-4"/>Download Template</button>}{hasUpload&&<button type="button" onClick={runUpload} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50"><Upload className="h-4 w-4"/>Choose File / Upload</button>}</div>}</div>}
    {canExport&&<div className="relative"><button type="button" onClick={()=>{setOpen(v=>!v);setImportOpen(false)}} className={base}><Download className="h-4 w-4"/><span className="hidden xl:inline">Export</span></button>{open&&<div className="absolute right-0 top-10 z-[70] w-48 rounded-lg border bg-white py-1 shadow-xl"><button type="button" onClick={()=>exp("excel")} className="flex w-full gap-2 px-3 py-2 text-xs"><Sheet className="h-4 w-4"/>Excel (.xlsx)</button><button type="button" onClick={()=>exp("csv")} className="flex w-full gap-2 px-3 py-2 text-xs"><Table2 className="h-4 w-4"/>CSV (.csv)</button><button type="button" onClick={()=>exp("word")} className="flex w-full gap-2 px-3 py-2 text-xs"><FileText className="h-4 w-4"/>Word (.doc)</button></div>}</div>}
    {canPrint&&<button type="button" data-print-selector={reportSelector()} onClick={print} className={base}><Printer className="h-4 w-4"/><span className="hidden xl:inline">Print / PDF</span></button>}
  </div>;
  if(standardPath&&standardHost)return createPortal(toolbar,standardHost);
  return toolbar;
}
