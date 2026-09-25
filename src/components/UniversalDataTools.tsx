import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, Printer, Settings2, Sheet, Table2 } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { hasPermission, type ModuleKey } from "@/auth/permissions";
import { exportDomReportToCSV, exportDomReportToExcel, exportDomReportToWord, triggerPrint } from "@/lib/exportUtils";
import ConsolidatedInvoiceTools from "@/components/ConsolidatedInvoiceTools";

function cleanTitle(v:string){return v.replace(/\s*\/\s*[\u0600-\u06FF].*$/,"").replace(/[^a-z0-9]+/gi,"-").replace(/^-+|-+$/g,"").toLowerCase()||"navilo-export"}
function journalListRoot(){
  if(window.location.pathname!=="/accounting")return null;
  const main=document.querySelector<HTMLElement>("#navilo-main-content");
  const table=main?.querySelector<HTMLElement>("table");
  return table?.closest<HTMLElement>("[data-report-content],[data-navilo-data-table],.card,.navilo-workflow-panel")||table?.parentElement||null;
}
function journalDetailRoot(){
  const main=document.querySelector<HTMLElement>("#navilo-main-content");
  if(!main||!window.location.pathname.startsWith("/accounting/"))return null;
  const heading=Array.from(main.querySelectorAll<HTMLElement>("h2,h3,h4")).find(el=>normalize(el.textContent||"")==="journal line items");
  return heading?.closest<HTMLElement>("[data-report-content],.card,.bg-white")||null;
}
function chartOfAccountsRoot(){
  if(window.location.pathname!=="/accounting/accounts")return null;
  const main=document.querySelector<HTMLElement>("#navilo-main-content");
  const table=main?.querySelector<HTMLElement>("table");
  return table?.closest<HTMLElement>("[data-report-content],[data-navilo-data-table],.rounded-2xl,.card")||table?.parentElement||null;
}
function consolidatedSalesRoot(){
  if(window.location.pathname!=="/sales/consolidated")return null;
  const main=document.querySelector<HTMLElement>("#navilo-main-content");
  if(!main)return null;
  const heading=Array.from(main.querySelectorAll<HTMLElement>("h1,h2")).find(el=>normalize(el.textContent||"")==="consolidated / hawala");
  if(!heading)return null;
  const tables=Array.from(main.querySelectorAll<HTMLElement>("table"));
  const listTable=tables.find(table=>normalize(table.querySelector("thead")?.textContent||"").includes("hawala no"));
  return listTable?.closest<HTMLElement>("[data-report-content],[data-navilo-data-table],section,.card")||listTable?.parentElement||null;
}
function consolidatedPurchaseRoot(){
  if(window.location.pathname!=="/purchase/consolidated")return null;
  const main=document.querySelector<HTMLElement>("#navilo-main-content");
  if(!main)return null;
  const tables=Array.from(main.querySelectorAll<HTMLElement>("table"));
  const listTable=tables.find(table=>{
    const head=normalize(table.querySelector("thead")?.textContent||"");
    return head.includes("invoice")&&head.includes("supplier")&&head.includes("status")&&head.includes("total");
  });
  return listTable?.closest<HTMLElement>("[data-report-content],[data-navilo-data-table],.card")||listTable?.parentElement||null;
}
function salesInvoiceDetailRoot(){
  const path=window.location.pathname;
  if(!/^\/sales\/[^/]+$/.test(path)||path==="/sales/new"||path==="/sales/consolidated"||path==="/sales/order-book")return null;
  const main=document.querySelector<HTMLElement>("#navilo-main-content");
  if(!main)return null;
  const headings=Array.from(main.querySelectorAll<HTMLElement>("h1,h2,h3,.text-\\[12px\\].font-semibold"));
  const invoiceLines=headings.find(el=>normalize(el.textContent||"").startsWith("invoice lines"));
  return invoiceLines?.closest<HTMLElement>("section.grid")||invoiceLines?.closest<HTMLElement>("section")||invoiceLines?.closest<HTMLElement>(".rounded-lg")||null;
}
function reportRoot(){return document.querySelector<HTMLElement>("[data-report-content]")||document.querySelector<HTMLElement>(".professional-report")||document.querySelector<HTMLElement>("#order-book-report")||salesInvoiceDetailRoot()||consolidatedPurchaseRoot()||consolidatedSalesRoot()||chartOfAccountsRoot()||journalDetailRoot()||journalListRoot()||document.querySelector<HTMLElement>("#navilo-main-content")}
function reportSelector(){
  if(document.querySelector("[data-report-content]"))return"[data-report-content]";
  if(document.querySelector(".professional-report"))return".professional-report";
  if(document.querySelector("#order-book-report"))return"#order-book-report";
  const generatedRoot=salesInvoiceDetailRoot()||consolidatedPurchaseRoot()||consolidatedSalesRoot()||chartOfAccountsRoot()||journalDetailRoot()||journalListRoot();
  if(generatedRoot){
    document.querySelectorAll<HTMLElement>("[data-navilo-generated-print-root]").forEach(el=>delete el.dataset.naviloGeneratedPrintRoot);
    generatedRoot.dataset.naviloGeneratedPrintRoot="true";
    return"[data-navilo-generated-print-root='true']";
  }
  return"#navilo-main-content";
}
function currentPageTitle(){const r=reportRoot()||document.body;return r.querySelector<HTMLElement>(".navilo-report-title,h1,h2,h3,.page-title")?.textContent?.replace(/\s+/g," ").trim()||document.querySelector<HTMLElement>("#navilo-main-content h1")?.textContent?.replace(/\s+/g," ").trim()||document.title||"NAVILO"}
function currentExportRoot(){return reportRoot()}
function normalize(v:string){return v.replace(/\s+/g," ").replace(/\.(xlsx|xls|csv|docx|doc|pdf)\b/gi,"").replace(/[()]/g,"").trim().toLowerCase()}
function moduleForPath(p:string):ModuleKey{if(p==="/")return"dashboard";if(p.startsWith("/sales/report"))return"reports";if(p.startsWith("/sales/charges"))return"master";if(p.startsWith("/sales"))return"sales";if(p.startsWith("/purchase"))return"purchase";if(p.startsWith("/master-data"))return"master";if(p.startsWith("/godown"))return"inventory";if(p.startsWith("/production")||p.startsWith("/cutting"))return"production";if(p.startsWith("/transport"))return"transport";if(p.startsWith("/reports"))return"reports";if(p.startsWith("/accounting"))return"accounting";if(p.startsWith("/settings"))return"settings";return"dashboard"}
function isReportPath(p:string){if(p.startsWith("/reports")||p.startsWith("/sales/report")||p==="/sales/person-ledger")return true;if(!p.startsWith("/accounting/"))return false;return ["/accounting/vat-register","/accounting/day-book","/accounting/ledgers","/accounting/payroll","/accounting/loans","/accounting/trial-balance","/accounting/profit-loss","/accounting/balance-sheet","/accounting/cash-flow","/accounting/audit-trail","/accounting/customer-invoice-statement"].some(x=>p===x||p.startsWith(`${x}/`))}
function isInvoiceEditorPath(p:string){return p==="/sales/new"||/^\/sales\/[^/]+\/edit$/.test(p)||p==="/purchase/new"}
function isExportDuplicate(v:string){const x=normalize(v);return x.includes("export")||x.includes("download excel")||x.includes("download csv")||x.includes("download word")||x==="excel"||x==="csv"||x==="word"||x.includes("print")||x==="pdf"||x.startsWith("pdf /")||x.includes("customize columns")||x.includes("print options")}
function isTemplateAction(v:string){const x=normalize(v);return x.includes("template")}
function isUploadAction(v:string){const x=normalize(v);return x==="import"||x.startsWith("import ")||x.includes("bulk import")||x.includes("bulk upload")||x.includes("choose file")||x.includes("load excel")||x.includes("load csv")||x.includes("upload csv")||x.includes("upload excel")||x.includes("upload file")}
function isPrimaryAction(v:string){const x=normalize(v);return /^(\+\s*)?(add|new|create)\s+(account|item|category|customer|supplier|employee|warehouse|godown|uom|unit|transporter|charge|invoice|sales invoice|purchase invoice|order|sales order|purchase order|work order|cutting order|gate pass|receipt|payment|journal|journal entry|voucher)/.test(x)||x.includes("save draft")||x.includes("new consolidated / hawala")||x.includes("new consolidated purchase")||x.includes("new consolidated")||x.includes("post invoice")||x.includes("post purchase invoice")||x.includes("post journal")||x.includes("reverse journal")||x.includes("main purchase invoice")||x.includes("stock adjustment")||x.includes("transfer stock")||x.includes("stock transfer")||x.includes("new loading token")||x.includes("loading token")}
function labelOf(el:HTMLElement){return el.textContent||el.getAttribute("aria-label")||el.getAttribute("title")||""}
function isDocumentOutputAction(el:HTMLElement){
  if(el.dataset.naviloKeepLocalAction==="true"||el.hasAttribute("data-direct-print")||el.hasAttribute("data-print-selector"))return true;
  const x=normalize(`${labelOf(el)} ${el.getAttribute("title")||""}`);
  const isOutput=x.includes("print")||x.includes("pdf");
  if(!isOutput)return false;
  const path=window.location.pathname;
  if(isInvoiceEditorPath(path))return true;
  if(/^\/purchase\/[^/]+$/.test(path)&&path!=="/purchase/new"&&path!=="/purchase/consolidated"&&path!=="/purchase/order-book")return true;
  if(/^\/sales\/[^/]+$/.test(path)&&path!=="/sales/new"&&path!=="/sales/consolidated"&&path!=="/sales/order-book")return true;
  const isDocument=/\b(receipt|voucher|gate pass|loading worksheet|closing|credit note|debit note|return note|purchase invoice|sales invoice|consolidated purchase|hawala)\b/.test(x);
  return isDocument;
}
function findLocalAction(predicate:(label:string)=>boolean){const main=document.querySelector<HTMLElement>("#navilo-main-content");if(!main)return null;return Array.from(main.querySelectorAll<HTMLElement>("button,a,[role='button']")).find(el=>!el.closest("[data-navilo-global-data-tools]")&&!isDocumentOutputAction(el)&&predicate(labelOf(el)))??null}

export default function UniversalDataTools(){
  const{pathname}=useLocation(),{activeCompany,activeBusinessUnit,isPlatformOwner}=useAuth();
  const[open,setOpen]=useState(false),[standardHost,setStandardHost]=useState<HTMLElement|null>(null),[hasCustomizableTable,setHasCustomizableTable]=useState(false),[hasLocalDocumentOutput,setHasLocalDocumentOutput]=useState(false);
  const ref=useRef<HTMLDivElement|null>(null);
  const genericReport=pathname==="/reports"||(pathname.startsWith("/reports/")&&!(["/reports/steel-stock","/reports/supplier-aging"].includes(pathname)));
  const reportMode=isReportPath(pathname),masterMode=pathname.startsWith("/master-data")||pathname==="/godown/master"||pathname==="/sales/charges",workspaceMode=pathname.startsWith("/sales")||pathname.startsWith("/purchase")||pathname.startsWith("/godown")||pathname.startsWith("/production")||pathname.startsWith("/cutting")||pathname.startsWith("/accounting"),standardPath=!genericReport&&(reportMode||masterMode||workspaceMode),invoiceEditor=isInvoiceEditorPath(pathname),customizable=hasCustomizableTable;
  const role=activeBusinessUnit?.membership_role??activeCompany?.membership_role,module=moduleForPath(pathname),permissions=activeBusinessUnit?.permissions??activeCompany?.permissions;
  const canCreate=isPlatformOwner||hasPermission(role,module,"create",permissions,false),canExport=isPlatformOwner||hasPermission(role,module,"export",permissions,false),canPrint=isPlatformOwner||hasPermission(role,module,"print",permissions,false);

  useEffect(()=>{const main=document.querySelector<HTMLElement>("#navilo-main-content");if(!main)return;if(reportMode)main.dataset.naviloScreenType="report";else delete main.dataset.naviloScreenType;if(standardPath)main.dataset.naviloStandard="true";else delete main.dataset.naviloStandard;return()=>{delete main.dataset.naviloScreenType;delete main.dataset.naviloStandard}},[reportMode,standardPath,pathname]);
  useEffect(()=>{const main=document.querySelector<HTMLElement>("#navilo-main-content");if(!main||!standardPath||genericReport){setHasCustomizableTable(false);return;}const scan=()=>{const next=Boolean(main.querySelector("[data-navilo-data-table],[data-navilo-customizable='true']"));setHasCustomizableTable(prev=>prev===next?prev:next)};scan();const o=new MutationObserver(scan);o.observe(main,{childList:true,subtree:true});return()=>{o.disconnect();setHasCustomizableTable(false)}},[pathname,standardPath,genericReport]);
  useEffect(()=>{const main=document.querySelector<HTMLElement>("#navilo-main-content");if(!main||!standardPath||genericReport){setHasLocalDocumentOutput(false);return;}const hidden=new Set<HTMLElement>();const scan=()=>{let documentOutput=false;main.querySelectorAll<HTMLElement>("button,a,[role='button']").forEach(el=>{if(el.closest("[data-navilo-global-data-tools]"))return;if(isDocumentOutputAction(el)){documentOutput=true;return;}const label=labelOf(el);if(isTemplateAction(label)||isUploadAction(label)||isExportDuplicate(label)){el.style.setProperty("display","none","important");el.dataset.naviloDuplicateGlobalAction="true";hidden.add(el)}});setHasLocalDocumentOutput(prev=>prev===documentOutput?prev:documentOutput)};scan();const o=new MutationObserver(scan);o.observe(main,{childList:true,subtree:true});return()=>{o.disconnect();hidden.forEach(el=>{el.style.removeProperty("display");delete el.dataset.naviloDuplicateGlobalAction});setHasLocalDocumentOutput(false)}},[pathname,standardPath,genericReport]);
  useEffect(()=>{
    if(!standardPath){setStandardHost(null);return;}
    const attach=()=>{
      const main=document.querySelector<HTMLElement>("#navilo-main-content");if(!main)return false;
      const explicit=main.querySelector<HTMLElement>("[data-navilo-standard-tools-host]");
      if(explicit){setStandardHost(explicit);return true;}
      const all=Array.from(main.querySelectorAll<HTMLElement>("button,a,[role='button']")).filter(el=>!el.closest("[data-navilo-global-data-tools]")&&!isDocumentOutputAction(el));
      const primary=all.find(el=>isPrimaryAction(labelOf(el)));
      const standardAction=all.find(el=>isTemplateAction(labelOf(el))||isUploadAction(labelOf(el))||isExportDuplicate(labelOf(el)));
      const anchor=primary??standardAction;
      let actions=anchor?.parentElement??null;
      if(!actions&&journalDetailRoot()){
        const entryHeading=main.querySelector<HTMLElement>("h1");
        const header=entryHeading?.closest<HTMLElement>(".bg-white");
        actions=(header?.lastElementChild as HTMLElement|null)??header??null;
      }
      if(!actions)return false;
      let host=actions.querySelector<HTMLElement>("[data-navilo-standard-tools-host]");
      if(!host){host=document.createElement("span");host.dataset.naviloStandardToolsHost="true";host.className="contents";actions.prepend(host)}
      setStandardHost(host);return true;
    };
    if(attach())return()=>setStandardHost(null);
    const observer=new MutationObserver(()=>{if(attach())observer.disconnect()});observer.observe(document.body,{childList:true,subtree:true});
    return()=>{observer.disconnect();setStandardHost(null)};
  },[standardPath,pathname]);
  useEffect(()=>{if(!open)return;const close=(e:MouseEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node))setOpen(false)};document.addEventListener("mousedown",close);return()=>document.removeEventListener("mousedown",close)},[open]);

  const exp=(t:"excel"|"csv"|"word")=>{if(!canExport)return;const root=currentExportRoot();if(!root)return;const title=currentPageTitle(),file=cleanTitle(title);if(t==="excel")exportDomReportToExcel(file,root,title);if(t==="csv")exportDomReportToCSV(file,root,title);if(t==="word")exportDomReportToWord(file,root,title);setOpen(false)};
  const print=()=>{if(canPrint){setOpen(false);triggerPrint(reportSelector())}};
  const base="navilo-report-tool";
  const toolbar=<div className="navilo-report-toolbar" ref={ref} data-no-print data-no-export data-navilo-global-data-tools>
    {!invoiceEditor&&customizable&&<button type="button" onClick={()=>window.dispatchEvent(new Event("navilo:report-customize"))} className={base}><Settings2 className="h-4 w-4"/><span>Customize</span></button>}
    {!invoiceEditor&&canExport&&<div className="relative"><button type="button" onClick={()=>setOpen(v=>!v)} className={base}><Download className="h-4 w-4"/><span className="hidden xl:inline">Export</span></button>{open&&<div className="absolute right-0 top-10 z-[70] w-48 rounded-lg border bg-white py-1 shadow-xl"><button type="button" onClick={()=>exp("excel")} className="flex w-full gap-2 px-3 py-2 text-xs"><Sheet className="h-4 w-4"/>Excel (.xlsx)</button><button type="button" onClick={()=>exp("csv")} className="flex w-full gap-2 px-3 py-2 text-xs"><Table2 className="h-4 w-4"/>CSV (.csv)</button><button type="button" onClick={()=>exp("word")} className="flex w-full gap-2 px-3 py-2 text-xs"><FileText className="h-4 w-4"/>Word (.doc)</button></div>}</div>}
    {!invoiceEditor&&canPrint&&!hasLocalDocumentOutput&&<button type="button" data-print-selector={reportSelector()} onClick={print} className={base}><Printer className="h-4 w-4"/><span className="hidden xl:inline">Print / PDF</span></button>}
  </div>;
  if(!standardPath)return null;
  return standardHost?createPortal(<><ConsolidatedInvoiceTools/>{toolbar}</>,standardHost):null;
}
