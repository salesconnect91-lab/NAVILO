import { isKnownDocumentLabel, normalizeDocumentLanguages, renderDocumentLabel } from "@/lib/documentI18n";

type Original = { value: string; translated: string };
const originals = new WeakMap<Text, Original>();
const RTL = /[\u0600-\u06FF]/;
const LATIN = /[A-Za-z]/;
const semanticSelector = "th,dt,label,h1,h2,h3,h4,h5,h6,legend,caption,[data-i18n-label],[data-document-label],[class*='label'],[class*='title'],[class*='heading'],.print-total-row span:first-child,.print-charge-row span:first-child";
const permanentRoots = ".print-document,[data-document-language-root]";
const printableRoots = "[data-navilo-primary-print-target='true'],[data-print-root],.print-report,.professional-report";

function config() {
  const root = document.documentElement;
  return normalizeDocumentLanguages(
    root.dataset.documentLanguageMode,
    root.dataset.documentPrimaryLanguage,
    root.dataset.documentSecondaryLanguage,
  );
}

function isBusinessData(node: Text) {
  const parent = node.parentElement;
  if (!parent) return true;
  if (parent.closest("[data-i18n-skip='true'],[data-business-data],script,style,code,pre,input,textarea")) return true;
  if (parent.closest("tbody td") && !parent.closest("[data-document-label]")) return true;
  return false;
}

function shouldTranslate(node: Text, value: string) {
  if (!value.trim() || isBusinessData(node)) return false;
  if (LATIN.test(value) && RTL.test(value)) return true;
  if (isKnownDocumentLabel(value)) return true;
  const parent = node.parentElement;
  return Boolean(parent?.matches(semanticSelector) || parent?.closest(semanticSelector));
}

function processText(node: Text) {
  const current = node.nodeValue || "";
  if (!current.trim()) return;

  let record = originals.get(node);
  if (!record) {
    record = { value: current, translated: current };
    originals.set(node, record);
  } else if (current !== record.value && current !== record.translated) {
    record = { value: current, translated: current };
    originals.set(node, record);
  }

  const source = record.value;
  if (!shouldTranslate(node, source)) {
    record.translated = source;
    if (node.nodeValue !== source) node.nodeValue = source;
    return;
  }

  const language = config();
  const leading = source.match(/^\s*/)?.[0] || "";
  const trailing = source.match(/\s*$/)?.[0] || "";
  const translated = `${leading}${renderDocumentLabel(source, language.mode, language.primary, language.secondary)}${trailing}`;
  record.translated = translated;
  if (node.nodeValue !== translated) node.nodeValue = translated;
}

function applyRoot(root: HTMLElement) {
  const language = config();
  root.dataset.naviloDocumentLanguageApplied = "true";
  root.dataset.naviloDocumentLanguage = language.mode === "bilingual" && language.secondary
    ? `${language.primary}+${language.secondary}`
    : language.primary;
  root.setAttribute("dir", language.mode === "single" && (language.primary === "ur" || language.primary === "ar") ? "rtl" : "ltr");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  nodes.forEach(processText);
}

function roots(includePrintTargets = false) {
  const selector = includePrintTargets ? `${permanentRoots},${printableRoots}` : permanentRoots;
  return Array.from(document.querySelectorAll<HTMLElement>(selector));
}

function applyPermanent() { roots(false).forEach(applyRoot); }
function applyForPrint() { roots(true).forEach(applyRoot); }

let queued = false;
function queueApply() {
  if (queued) return;
  queued = true;
  window.setTimeout(() => {
    queued = false;
    applyPermanent();
  }, 0);
}

const observer = new MutationObserver(queueApply);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
  attributeFilter: ["data-document-language-mode", "data-document-primary-language", "data-document-secondary-language", "data-navilo-primary-print-target"],
});

document.addEventListener("DOMContentLoaded", queueApply, { once: true });
window.addEventListener("navilo-language-changed", queueApply as EventListener);
window.addEventListener("navilo:language-changed", queueApply as EventListener);
window.addEventListener("beforeprint", applyForPrint);
queueApply();
