import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { usePlatformBranding } from "@/lib/platformBranding";

type PrintOrientation = "portrait" | "landscape";
type PreviewPayload = { html: string; title: string; orientation: PrintOrientation };
type PreviewEventDetail = { html?: string; title?: string; selector?: string; orientation?: PrintOrientation };
type PrintContext = {
  companyName: string;
  businessUnitName: string;
  showPlatformBranding: boolean;
  platformName: string;
  platformTagline: string;
  platformLogo: string;
};

const UI_SELECTORS = [
  "button", "input", "select", "textarea", "nav", "aside", "[role='search']", ".no-print", ".print\\:hidden", "[data-no-print]", "[data-print-ui]", ".page-actions", ".search-bar", ".search-box", ".filter-bar", ".filter-toolbar", ".table-toolbar", ".business-workspace", ".business-workspace-switcher", ".company-switcher", ".business-unit-switcher", "[data-workspace-switcher]", "[class*='workspace-switcher']", "[class*='company-switcher']", "[class*='business-unit-switcher']",
].join(",");

function getPrintableTarget(selector?: string) {
  if (selector) {
    const selected = document.querySelector<HTMLElement>(selector);
    if (selected) return selected;
  }
  return document.querySelector<HTMLElement>("#printable-invoice-area") || document.querySelector<HTMLElement>(".print-document") || document.querySelector<HTMLElement>("[data-print-root]") || document.querySelector<HTMLElement>(".print-report") || document.querySelector<HTMLElement>("main");
}

function getButtonPrintableTarget(button: HTMLButtonElement) {
  if (button.dataset.printSelector) {
    const selected = document.querySelector<HTMLElement>(button.dataset.printSelector);
    if (selected) return selected;
  }
  let node: HTMLElement | null = button.parentElement;
  while (node && node.tagName !== "MAIN") {
    const hasContent = Boolean(node.querySelector("table,.data-table,.print-report,.professional-report,[data-print-root]"));
    const hasHeading = Boolean(node.querySelector(".page-header,.page-title,h1,h2"));
    if (hasContent && hasHeading) return node;
    node = node.parentElement;
  }
  return getPrintableTarget();
}

function textOf(root: HTMLElement, selector: string) { return root.querySelector<HTMLElement>(selector)?.textContent?.replace(/\s+/g, " ").trim() || ""; }
function createTextElement(tag: string, className: string, text: string) { const el = document.createElement(tag); el.className = className; el.textContent = text; return el; }
function detectOrientation(root: HTMLElement): PrintOrientation {
  const tables = Array.from(root.querySelectorAll("table"));
  const widest = tables.reduce((max, table) => Math.max(max, table.querySelectorAll("thead tr:first-child th").length || table.querySelectorAll("tr:first-child > *").length), 0);
  return widest >= 7 ? "landscape" : "portrait";
}

function currentLanguageMode(scope: "screen" | "document" = "document") {
  if (scope === "screen") return { mode: document.documentElement.dataset.languageMode || "single", primary: document.documentElement.dataset.primaryLanguage || "en" };
  return { mode: document.documentElement.dataset.documentLanguageMode || "single", primary: document.documentElement.dataset.documentPrimaryLanguage || "en" };
}

function localizedLabel(english: string, urdu: string) {
  const { mode, primary } = currentLanguageMode("screen");
  if (mode === "bilingual") return `${english} / ${urdu}`;
  return primary === "ur" ? urdu : english;
}

function filterTextForLanguage(value: string) {
  const { mode, primary } = currentLanguageMode("document");
  if (mode === "bilingual") return value;
  if (!/[\u0600-\u06FF]/.test(value) || !value.includes("/")) return value;
  const parts = value.split("/").map((part) => part.trim()).filter(Boolean);
  const urduParts = parts.filter((part) => /[\u0600-\u06FF]/.test(part));
  const latinParts = parts.filter((part) => !/[\u0600-\u06FF]/.test(part));
  const selected = primary === "ur" ? urduParts : latinParts;
  return selected.length ? selected.join(" / ") : value;
}

function applyPrintLanguage(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  nodes.forEach((node) => { if (node.nodeValue?.trim()) node.nodeValue = filterTextForLanguage(node.nodeValue); });
}

function removeActionColumns(root: HTMLElement) {
  root.querySelectorAll("table").forEach((table) => {
    const headerCells = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead tr:first-child th"));
    const actionIndexes = headerCells.map((cell, index) => ({ index, label: (cell.textContent || "").trim().toLowerCase() })).filter(({ label }) => /^(actions?|action|عمل|کارروائی)$/.test(label)).map(({ index }) => index).sort((a, b) => b - a);
    if (!actionIndexes.length) return;
    Array.from(table.rows).forEach((row) => actionIndexes.forEach((index) => row.cells[index]?.remove()));
  });
}

function removeEmptyUiShells(root: HTMLElement) {
  Array.from(root.querySelectorAll<HTMLElement>("form,label,.relative,.flex,.grid")).reverse().forEach((node) => {
    if (node.querySelector("table,img,svg,[data-print-keep]") || (node.textContent || "").trim()) return;
    if (node.children.length === 0) node.remove();
  });
}

function removeGenericNoise(root: HTMLElement) {
  const exactNoise = new Set(["Steel Mill ERP", "Read-only posted accounting records"]);
  root.querySelectorAll<HTMLElement>("p,div,span").forEach((node) => {
    const text = (node.textContent || "").replace(/\s+/g, " ").trim();
    if (exactNoise.has(text) && node.children.length === 0) node.remove();
    if (/^Ledger entries are read-only here\./i.test(text) && node.children.length === 0) node.remove();
  });
}

function decorateGenericReport(clone: HTMLElement, context: PrintContext, reportTitle: string, subtitle: string) {
  clone.classList.add("professional-report", "navilo-generic-report");
  clone.setAttribute("data-navilo-generic-print", "true");
  const printedAt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date());
  const header = document.createElement("header"); header.className = "navilo-report-header";
  const identity = document.createElement("div"); identity.className = "navilo-report-identity";
  if (context.showPlatformBranding && context.platformLogo) { const logo = document.createElement("img"); logo.src = context.platformLogo; logo.alt = context.platformName || "ERP"; logo.className = "navilo-report-logo"; identity.appendChild(logo); }
  identity.appendChild(createTextElement("div", "navilo-report-company-name", context.companyName || "ERP"));
  if (context.businessUnitName) identity.appendChild(createTextElement("div", "navilo-report-business-unit", context.businessUnitName));
  const meta = document.createElement("div"); meta.className = "navilo-report-meta";
  meta.appendChild(createTextElement("h1", "navilo-report-title", reportTitle || filterTextForLanguage("Report / رپورٹ")));
  if (subtitle && subtitle !== reportTitle) meta.appendChild(createTextElement("div", "navilo-report-subtitle", subtitle));
  meta.appendChild(createTextElement("div", "navilo-report-date", `${filterTextForLanguage("Printed / پرنٹ وقت")}: ${printedAt}`));
  header.append(identity, meta);
  const footer = document.createElement("footer"); footer.className = "navilo-report-footer";
  const left = context.showPlatformBranding && context.platformName ? context.platformName : context.companyName;
  footer.appendChild(createTextElement("span", "", left || "ERP")); footer.appendChild(createTextElement("span", "navilo-page-number", filterTextForLanguage("Page / صفحہ")));
  clone.prepend(header); clone.appendChild(footer);
}

function cleanClone(target: HTMLElement, context: PrintContext) {
  const reportTitle = textOf(target, ".page-title") || textOf(target, "h1") || textOf(target, "h2") || "Report / رپورٹ";
  const subtitle = textOf(target, ".page-subtitle");
  const clone = target.cloneNode(true) as HTMLElement;
  const isDocument = clone.classList.contains("print-document") || Boolean(clone.querySelector(".print-document"));
  clone.querySelectorAll(UI_SELECTORS).forEach((node) => node.remove());
  if (!isDocument) {
    clone.querySelector(".page-header")?.remove();
    const firstTitle = Array.from(clone.querySelectorAll("h1,h2")).find((node) => (node.textContent || "").replace(/\s+/g, " ").trim() === reportTitle);
    firstTitle?.remove(); removeActionColumns(clone); removeGenericNoise(clone); removeEmptyUiShells(clone); decorateGenericReport(clone, context, filterTextForLanguage(reportTitle), filterTextForLanguage(subtitle));
  }
  applyPrintLanguage(clone);
  clone.querySelectorAll<HTMLElement>("[style]").forEach((node) => { node.style.maxWidth = node.style.maxWidth || "100%"; });
  Object.assign(clone.style, { display: "block", visibility: "visible", width: "100%", maxWidth: "100%" });
  return { html: clone.outerHTML, orientation: isDocument ? ("portrait" as const) : detectOrientation(clone) };
}

function collectStyles() { return Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map((node) => node.outerHTML).join("\n"); }
const FRAME_CSS = `html,body{background:#fff!important;color:#111827!important;margin:0!important;padding:0!important;width:100%!important}*,*::before,*::after{box-sizing:border-box!important}button,input,select,textarea,.no-print,[data-no-print],[data-print-ui],nav,aside{display:none!important}img,svg{max-width:100%!important}`;

async function waitForPrintAssets(doc: Document) {
  const links = Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
  const waitForLink = (link: HTMLLinkElement) => new Promise<void>((resolve) => {
    if (link.sheet) { resolve(); return; }
    let settled = false;
    const done = () => { if (settled) return; settled = true; resolve(); };
    link.addEventListener("load", done, { once: true });
    link.addEventListener("error", done, { once: true });
    window.setTimeout(done, 4000);
  });
  await Promise.all(links.map(waitForLink));
  await Promise.all(Array.from(doc.images).map((img) => img.complete ? Promise.resolve() : new Promise<void>((resolve) => {
    const done = () => resolve();
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
  })));
  if (doc.fonts?.ready) await doc.fonts.ready;
  await new Promise<void>((resolve) => {
    const view = doc.defaultView;
    if (view?.requestAnimationFrame) view.requestAnimationFrame(() => view.requestAnimationFrame(() => resolve()));
    else window.setTimeout(resolve, 80);
  });
}

export default function PrintPreviewController() {
  const { activeCompany, activeBusinessUnit } = useAuth();
  const { branding } = usePlatformBranding();
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const styleMarkup = useMemo(() => collectStyles(), [preview]);
  const context: PrintContext = { companyName: activeCompany?.company_name || "ERP", businessUnitName: activeBusinessUnit?.business_unit_name || "", showPlatformBranding: branding.show_branding && branding.show_on_prints, platformName: branding.erp_name || "", platformTagline: branding.show_tagline ? branding.tagline || "" : "", platformLogo: branding.logo_url || "" };

  useEffect(() => {
    const nativePrint = window.print;
    const showTargetPreview = (target: HTMLElement, title?: string, forcedOrientation?: PrintOrientation) => { const cleaned = cleanClone(target, context); setMaximized(false); setMinimized(false); setPreview({ html: cleaned.html, title: title || document.title || "ERP", orientation: forcedOrientation || cleaned.orientation }); };
    const openPreview = () => { const target = getPrintableTarget(); if (!target) nativePrint.call(window); else showTargetPreview(target); };
    const onPreviewEvent = (event: Event) => {
      const detail = (event as CustomEvent<PreviewEventDetail>).detail || {};
      if (detail.html) { const wrapper = document.createElement("div"); wrapper.innerHTML = detail.html; applyPrintLanguage(wrapper); setMaximized(false); setMinimized(false); setPreview({ html: wrapper.innerHTML, title: detail.title || document.title || "ERP", orientation: detail.orientation || "portrait" }); return; }
      const target = getPrintableTarget(detail.selector); if (target) showTargetPreview(target, detail.title, detail.orientation);
    };
    const onPrintClick = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest("button");
      if (!(button instanceof HTMLButtonElement) || button.closest("[data-navilo-print-preview]") || button.hasAttribute("data-direct-print")) return;
      const label = (button.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (/\bprint loading worksheet\b|\bprint final gp\b|\bprint token\b/.test(label) || !/\bprint\b|پرنٹ/.test(label)) return;
      const target = getButtonPrintableTarget(button); if (!target) return; event.preventDefault(); event.stopPropagation(); showTargetPreview(target);
    };
    window.addEventListener("navilo:print-preview", onPreviewEvent as EventListener); document.addEventListener("click", onPrintClick, true);
    const timer = window.setTimeout(() => { window.print = openPreview; }, 0);
    return () => { window.clearTimeout(timer); window.removeEventListener("navilo:print-preview", onPreviewEvent as EventListener); document.removeEventListener("click", onPrintClick, true); if (window.print === openPreview) window.print = nativePrint; };
  }, [context.companyName, context.businessUnitName, context.showPlatformBranding, context.platformName, context.platformTagline, context.platformLogo]);

  useEffect(() => {
    if (!preview) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setPreview(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  const printNow = () => {
    if (!preview) return;
    const frame = document.createElement("iframe"); frame.setAttribute("aria-hidden", "true"); Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "1px", height: "1px", opacity: "0", pointerEvents: "none", border: "0" }); document.body.appendChild(frame);
    const doc = frame.contentDocument; if (!doc) { frame.remove(); return; }
    const pageRule = preview.orientation === "landscape" ? "@page{size:A4 landscape;margin:10mm}" : "@page{size:A4 portrait;margin:10mm}";
    doc.open(); doc.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${document.baseURI}"><title>${preview.title}</title>${styleMarkup}<style>${FRAME_CSS}${pageRule}</style></head><body><div class="navilo-print-output navilo-${preview.orientation}">${preview.html}</div></body></html>`); doc.close();
    const executePrint = async () => {
      try { await waitForPrintAssets(doc); } catch { /* print with available assets */ }
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      window.setTimeout(() => frame.remove(), 2500);
    };
    if (doc.readyState === "complete") void executePrint(); else frame.onload = () => void executePrint();
  };

  if (!preview) return null;
  const previewWidth = preview.orientation === "landscape" ? "297mm" : "210mm";
  const previewMinHeight = preview.orientation === "landscape" ? "210mm" : "297mm";
  const shellWidth = maximized ? "max-w-none" : "max-w-7xl";

  return <div className="fixed inset-0 z-[100000] flex flex-col bg-slate-950/80 p-3 backdrop-blur-sm md:p-5" data-no-bilingual data-navilo-print-preview role="dialog" aria-modal="true" aria-label="Print Preview">
    <div className={`mx-auto mb-2 flex w-full ${shellWidth} items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-xl`}>
      <div><div className="text-sm font-bold text-slate-900">{localizedLabel("Print Preview", "پرنٹ پیش منظر")}</div><div className="mt-0.5 text-[11px] text-slate-500">A4 {preview.orientation} · clean document output · Esc closes</div></div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" onClick={() => setMinimized((value) => !value)} aria-label={minimized ? "Restore preview" : "Minimize preview"}>{minimized ? "Restore" : "Minimize"}</button>
        <button type="button" className="btn-secondary" onClick={() => setMaximized((value) => !value)} aria-label={maximized ? "Restore preview size" : "Maximize preview"}>{maximized ? "Window" : "Maximize"}</button>
        <button type="button" className="btn-primary" onClick={printNow}>{localizedLabel("Print / Save PDF", "پرنٹ / پی ڈی ایف محفوظ کریں")}</button>
        <button type="button" className="btn-secondary" onClick={() => setPreview(null)} aria-label="Close print preview" title="Close">✕</button>
      </div>
    </div>
    {!minimized && <div className={`mx-auto w-full ${shellWidth} flex-1 overflow-auto rounded-xl bg-slate-300 p-3 shadow-xl md:p-5`}>
      <div className="mx-auto bg-white shadow-lg" style={{ width: previewWidth, minHeight: previewMinHeight, padding: "10mm", display: "block", visibility: "visible" }}><div className={`navilo-live-preview navilo-${preview.orientation}`} dangerouslySetInnerHTML={{ __html: preview.html }} /></div>
    </div>}
  </div>;
}