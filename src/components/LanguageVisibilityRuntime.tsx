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

  // Urdu-only legacy controls must never masquerade as an Arabic, Hindi or
  // Chinese converter. Hide the entire field, including its Auto Urdu button.
  // This is display isolation only: persistence must be fixed in each module.
  root.querySelectorAll<HTMLLabelElement>("label").forEach((label) => {
    if (!/\b(?:Urdu Name|Designation Urdu|Department Urdu)\b/i.test(label.textContent || "")) return;
    const host = languageFieldHost(label);
    if (host) setVisible(host, active.has("ur"));
  });

  // Arabic and Urdu share a script, but are different languages. Never use
  // Arabic selection as permission to expose an untagged legacy Urdu value.
  root.querySelectorAll<HTMLElement>("[dir='rtl']:not([data-language-code]):not([data-language])").forEach((element) => {
    if (element.matches("input,textarea,[contenteditable='true']")) return;
    const value = (element.textContent || "").trim();
    if (!value || !RTL_SCRIPT.test(value) || LATIN_SCRIPT.test(value)) return;
    setVisible(element, active.has("ur"));
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
