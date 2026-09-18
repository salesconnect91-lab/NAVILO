import { useEffect } from "react";
import { NAVILO_LANGUAGES, isSupportedRuntimeLanguage, type RuntimeLanguageCode } from "@/lib/languageConfig";

const LANGUAGE_ALIASES: Partial<Record<RuntimeLanguageCode, string[]>> = {
  ur: ["اردو"], ar: ["العربية"], hi: ["हिन्दी", "हिंदी"], bn: ["বাংলা"], fa: ["فارسی"],
  tr: ["türkçe"], fr: ["français"], es: ["español"], de: ["deutsch"], pt: ["português"],
  ru: ["русский"], zh: ["中文"], id: ["bahasa indonesia"], ms: ["bahasa melayu"],
};
const LANGUAGE_NAMES = Object.fromEntries(NAVILO_LANGUAGES.map((language) => [
  language.code,
  [language.label.toLowerCase(), language.nativeLabel.toLowerCase(), ...(LANGUAGE_ALIASES[language.code] || [])],
])) as Record<RuntimeLanguageCode, string[]>;
const HIDDEN_ATTR = "data-navilo-language-hidden";
const RTL_SCRIPT = /[\u0600-\u06FF]/;
const LATIN_SCRIPT = /[A-Za-z]/;
// Legacy Employees captions embed translations in the same text node. Keep the
// original text so switching workspaces can restore it without losing content.
const originalCaptions = new WeakMap<Text, string>();
const LEGACY_EMPLOYEE_CAPTIONS = /^(?:Add Employee|Edit Employee|Save Employee|Cancel|Employee Code|Employees|Total Records|Employee name is required)\s*\/\s*.+$/i;

function selectedLanguages() {
  const root = document.documentElement;
  const primary: RuntimeLanguageCode = isSupportedRuntimeLanguage(root.dataset.primaryLanguage) ? root.dataset.primaryLanguage : "en";
  const secondary: RuntimeLanguageCode | null = isSupportedRuntimeLanguage(root.dataset.secondaryLanguage) ? root.dataset.secondaryLanguage : null;
  const bilingual = root.dataset.languageMode === "bilingual" && secondary && secondary !== primary;
  return new Set<RuntimeLanguageCode>(bilingual ? [primary, secondary] : [primary]);
}
function specificLanguage(text: string): RuntimeLanguageCode | null {
  const value = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!value) return null;
  const hasFieldHint = /(name|translation|label|description|title)/i.test(value);
  for (const [code, names] of Object.entries(LANGUAGE_NAMES) as [RuntimeLanguageCode, string[]][]) {
    if (names.some((name) => value.includes(name)) && (hasFieldHint || /[^\u0000-\u007f]/.test(value))) return code;
  }
  return null;
}
function setVisible(element: HTMLElement, visible: boolean) {
  if (visible) {
    if (element.getAttribute(HIDDEN_ATTR) === "true") { element.hidden = false; element.removeAttribute(HIDDEN_ATTR); }
  } else { element.hidden = true; element.setAttribute(HIDDEN_ATTR, "true"); }
}
function updateTable(table: HTMLTableElement, active: Set<RuntimeLanguageCode>) {
  const headerRow = table.tHead?.rows?.[0] ?? table.querySelector("tr");
  if (!headerRow) return;
  [...headerRow.cells].forEach((cell, index) => {
    const code = specificLanguage(cell.textContent || "");
    if (!code) return;
    for (const row of [...table.rows]) { const target = row.cells[index] as HTMLElement | undefined; if (target) setVisible(target, active.has(code)); }
  });
}
function languageFieldHost(label: HTMLLabelElement) {
  const explicit = label.closest<HTMLElement>("[data-language-field]");
  if (explicit) return explicit;
  let candidate: HTMLElement | null = label.parentElement;
  for (let depth = 0; candidate && depth < 3; depth += 1, candidate = candidate.parentElement) {
    if (candidate.querySelector("input,textarea,select,[role='combobox']")) return candidate;
  }
  return label.parentElement;
}
function updateLegacyEmployeeCaptions(root: ParentNode, active: Set<RuntimeLanguageCode>) {
  // Only touch the Employees modal, not unrelated pages or user-entered data.
  root.querySelectorAll<HTMLElement>("[role='dialog'],.fixed").forEach((modal) => {
    if (!/\b(?:Add Employee|Edit Employee)\b/.test(modal.textContent || "")) return;
    const walker = document.createTreeWalker(modal, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node as Text;
      const parent = text.parentElement;
      if (!parent || parent.closest("input,textarea,select,[contenteditable='true']")) continue;
      const original = originalCaptions.get(text) ?? text.data;
      if (!LEGACY_EMPLOYEE_CAPTIONS.test(original.trim())) continue;
      if (!originalCaptions.has(text)) originalCaptions.set(text, original);
      const separator = original.indexOf("/");
      const translation = original.slice(separator + 1).trim();
      // The old hard-coded caption translations are Arabic/Urdu, never Hindi.
      const translatedLanguage = /[\u0600-\u06FF]/.test(translation) ? "ar" : null;
      const visible = translatedLanguage && active.has(translatedLanguage) ? original : original.slice(0, separator).trimEnd();
      if (text.data !== visible) text.data = visible;
    }
  });
}
function updateLanguageFields(root: ParentNode, active: Set<RuntimeLanguageCode>) {
  root.querySelectorAll<HTMLElement>("[data-language-code],[data-language]").forEach((element) => {
    const raw = element.dataset.languageCode || element.dataset.language || "";
    if (isSupportedRuntimeLanguage(raw)) setVisible(element, active.has(raw));
  });
  root.querySelectorAll<HTMLTableElement>("table").forEach((table) => updateTable(table, active));
  root.querySelectorAll<HTMLLabelElement>("label").forEach((label) => {
    const code = specificLanguage(label.textContent || "");
    if (!code) return;
    const host = languageFieldHost(label);
    if (host) setVisible(host, active.has(code));
  });
  // Legacy employee fields store Urdu only; never expose Auto Urdu controls
  // as if they could convert into another selected language.
  root.querySelectorAll<HTMLLabelElement>("label").forEach((label) => {
    if (!/\b(?:Urdu Name|Designation Urdu|Department Urdu)\b/i.test(label.textContent || "")) return;
    const host = languageFieldHost(label);
    if (host) setVisible(host, active.has("ur"));
  });
  updateLegacyEmployeeCaptions(root, active);
  // Untagged RTL text can be Arabic, Persian or Urdu. Preserve existing
  // script visibility until each value is tagged with its exact locale.
  root.querySelectorAll<HTMLElement>("[dir='rtl']:not([data-language-code]):not([data-language])").forEach((element) => {
    if (element.matches("input,textarea,[contenteditable='true']")) return;
    const value = (element.textContent || "").trim();
    if (!value || !RTL_SCRIPT.test(value) || LATIN_SCRIPT.test(value)) return;
    const rtlEnabled = active.has("ur") || active.has("ar") || active.has("fa");
    setVisible(element, rtlEnabled);
  });
}
export default function LanguageVisibilityRuntime() {
  useEffect(() => {
    let frame = 0;
    const apply = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (/language/i.test(window.location.pathname)) return;
        updateLanguageFields(document.body, selectedLanguages());
      });
    };
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("navilo-language-changed", apply);
    window.addEventListener("navilo:language-changed", apply);
    window.addEventListener("navilo-workspace-changed", apply);
    apply();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("navilo-language-changed", apply); window.removeEventListener("navilo:language-changed", apply); window.removeEventListener("navilo-workspace-changed", apply); };
  }, []);
  return null;
}
