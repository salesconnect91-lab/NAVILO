import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, Languages, Printer, Settings2, Sheet, Table2 } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { hasPermission, type ModuleKey } from "@/auth/permissions";
import { exportDomReportToCSV, exportDomReportToExcel, exportDomReportToWord, triggerPrint } from "@/lib/exportUtils";
import UserLanguagePreference from "@/components/UserLanguagePreference";

function cleanTitle(v:string){return v.replace(/\s*\/\s*[\u0600-\u06FF].*$/,"").replace(/[^a-z0-9]+/gi,"-").replace(/^-+|-+$/g,"").toLowerCase()||"navilo-export"}
function currentPageTitle(){const r=document.querySelector<HTMLElement>("[data-report-content]")||document.querySelector<HTMLElement>("#navilo-main-content")||document.body;return r.querySelector<HTMLElement>(".navilo-report-title,h1,h2,.page-title")?.textContent?.replace(/\s+/g," ").trim()||document.title||"NAVILO"}
function currentExportRoot(){return document.querySelector<HTMLElement>("[data-report-content]")||document.querySelector<HTMLElement>("#navilo-main-content")}
function normalize(v:string){return v.replace(/\s+/g," ").replace(/\.(xlsx|xls|csv|docx|doc|pdf)\b/gi,"").replace(/[()]/g,"").trim().toLowerCase()}
function moduleForPath(p:string):ModuleKey{if(p==="/")return"dashboard";if(p.startsWith("/sales/report"))return"reports";if(p.startsWith("/sales/charges"))return"master";if(p.startsWith("/sales"))return"sales";if(p.startsWith("/purchase"))return"purchase";if(p.startsWith("/master-data"))return"master";if(p.startsWith("/godown"))return"inventory";if(p.startsWith("/production")||p.startsWith("/cutting"))return"production";if(p.startsWith("/transport"))return"transport";if(p.startsWith("/reports"))return"reports";if(p.startsWith("/accounting"))return"accounting";if(p.startsWith("/settings"))return"settings";return"dashboard"}
function isReportPath(p:string){if(p.startsWith("/reports")||p.startsWith("/sales/report")||p==="/sales/person-ledger")return true;if(!p.startsWith("/accounting/"))return false;return ["/accounting/vat-register","/accounting/day-book","/accounting/ledgers","/accounting/payroll","/accounting/loans","/accounting/bank-reconciliation","/accounting/trial-balance","/accounting/profit-loss","/accounting/balance-sheet","/accounting/cash-flow","/accounting/controls","/accounting/audit-trail","/accounting/customer-invoice-statement"].some(x=>p===x||p.startsWith(`${x}/`))}
function isDuplicate(v:string){const x=normalize(v);return x.includes("export")||x.includes("download excel")||x.includes("download csv")||x.includes("download word")||x==="excel"||x==="csv"||x==="word"||x.includes("print")||x==="pdf"||x.startsWith("pdf /")||x.includes("customize columns")||x.includes("print options")}

export default function UniversalDataTools(){
  const{pathname}=useLocation(),{activeCompany,activeBusinessUnit,isPlatformOwner}=useAuth();
  const[open,setOpen]=useState(false),[languageOpen,setLanguageOpen]=useState(false),[itemsHost,setItemsHost]=useState<HTMLElement|null>(null);
  const ref=useRef<HTMLDivElement|null>(null);
  const reportMode=isReportPath(pathname),itemsMaster=pathname==="/master-data",customizable=reportMode||itemsMaster,journalList=pathname==="/accounting";
  const role=activeBusinessUnit?.membership_role??activeCompany?.membership_role,module=moduleForPath(pathname),permissions=activeBusinessUnit?.permissions??activeCompany?.permissions;
  const canExport=isPlatformOwner||hasPermission(role,module,"export",permissions,false),canPrint=isPlatformOwner||hasPermission(role,module,"print",permissions,false);

  useEffect(()=>{const main=document.querySelector<HTMLElement>("#navilo-main-content");if(!main)return;if(reportMode)main.dataset.naviloScreenType="report";else delete main.dataset.naviloScreenType;return()=>{delete main.dataset.naviloScreenType}},[reportMode,pathname]);
  useEffect(()=>{const main=document.querySelector<HTMLElement>("#navilo-main-content");if(!main)return;const suppress=()=>main.querySelectorAll<HTMLElement>("button,a,[role='button']").forEach(el=>{if(el.closest("[data-navilo-global-data-tools]")||el.dataset.naviloKeepLocalAction==="true")return;const label=el.textContent||el.getAttribute("aria-label")||el.getAttribute("title")||"";if(reportMode&&isDuplicate(label)){el.style.setProperty("display","none","important");el.dataset.naviloDuplicateGlobalAction="true"}});suppress();const o=new MutationObserver(suppress);o.observe(main,{childList:true,subtree:true,characterData:true});return()=>o.disconnect()},[pathname,reportMode]);
  useEffect(()=>{
    if(!itemsMaster){setItemsHost(null);return;}
    const attach=()=>{
      const main=document.querySelector<HTMLElement>("#navilo-main-content");
      if(!main)return false;
      const addButton=Array.from(main.querySelectorAll<HTMLButtonElement>("button")).find(b=>normalize(b.textContent||"")==="add item");
      const actions=addButton?.parentElement;
      if(!actions)return false;
      let host=actions.querySelector<HTMLElement>("[data-navilo-items-global-tools-host]");
      if(!host){host=document.createElement("div");host.dataset.naviloItemsGlobalToolsHost="true";host.className="contents";actions.prepend(host);}
      setItemsHost(host);return true;
    };
    if(attach())return()=>setItemsHost(null);
    const observer=new MutationObserver(()=>{if(attach())observer.disconnect()});observer.observe(document.body,{childList:true,subtree:true});
    return()=>{observer.disconnect();setItemsHost(null)};
  },[itemsMaster,pathname]);
  useEffect(()=>{if(!journalList)return;const s=document.createElement("style");s.textContent='button[title^="Print journal voucher"]{display:none!important}';document.head.appendChild(s);return()=>s.remove()},[journalList]);
  useEffect(()=>{if(!open&&!languageOpen)return;const close=(e:MouseEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node)){setOpen(false);setLanguageOpen(false)}};document.addEventListener("mousedown",close);return()=>document.removeEventListener("mousedown",close)},[open,languageOpen]);

  const exp=(t:"excel"|"csv"|"word")=>{if(!canExport)return;const root=currentExportRoot();if(!root)return;const title=currentPageTitle(),file=cleanTitle(title);if(t==="excel")exportDomReportToExcel(file,root,title);if(t==="csv")exportDomReportToCSV(file,root,title);if(t==="word")exportDomReportToWord(file,root,title);setOpen(false)};
  const print=()=>{if(canPrint){setOpen(false);triggerPrint(document.querySelector("[data-report-content]")?"[data-report-content]":"#navilo-main-content")}};
  const base=reportMode?"navilo-report-tool":"inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-bold text-slate-700 shadow-sm hover:bg-slate-50";

  const toolbar=<div className={reportMode?"navilo-report-toolbar":"relative flex items-center gap-2"} ref={ref} data-no-print data-no-export data-navilo-global-data-tools>
    <div className="relative"><button type="button" onClick={()=>{setLanguageOpen(v=>!v);setOpen(false)}} className={base}><Languages className="h-4 w-4"/><span className="hidden xl:inline">Language</span></button>{languageOpen&&<div className="absolute right-0 top-10 z-[80] w-[min(92vw,520px)] rounded-lg border bg-white p-2 shadow-xl"><UserLanguagePreference/></div>}</div>
    {customizable&&<button type="button" onClick={()=>window.dispatchEvent(new Event("navilo:report-customize"))} className={base}><Settings2 className="h-4 w-4"/><span>Customize</span></button>}
    {canExport&&<div className="relative"><button type="button" onClick={()=>{setOpen(v=>!v);setLanguageOpen(false)}} className={base}><Download className="h-4 w-4"/><span className="hidden xl:inline">Export</span></button>{open&&<div className="absolute right-0 top-10 z-[70] w-48 rounded-lg border bg-white py-1 shadow-xl"><button type="button" onClick={()=>exp("excel")} className="flex w-full gap-2 px-3 py-2 text-xs"><Sheet className="h-4 w-4"/>Excel (.xlsx)</button><button type="button" onClick={()=>exp("csv")} className="flex w-full gap-2 px-3 py-2 text-xs"><Table2 className="h-4 w-4"/>CSV (.csv)</button><button type="button" onClick={()=>exp("word")} className="flex w-full gap-2 px-3 py-2 text-xs"><FileText className="h-4 w-4"/>Word (.doc)</button></div>}</div>}
    {canPrint&&<button type="button" data-print-selector={document.querySelector("[data-report-content]")?"[data-report-content]":undefined} onClick={print} className={base}><Printer className="h-4 w-4"/><span className="hidden xl:inline">Print / PDF</span></button>}
  </div>;

  if(itemsMaster)return itemsHost?createPortal(toolbar,itemsHost):null;
  return toolbar;
}
