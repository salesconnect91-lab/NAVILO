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

function selectedLanguages() {
  const root = document.documentElement;
  const primary: RuntimeLanguageCode = isSupportedRuntimeLanguage(root.dataset.primaryLanguage) ? root.dataset.primaryLanguage : "en";
  const secondary: RuntimeLanguageCode | null = isSupportedRuntimeLanguage(root.dataset.secondaryLanguage) ? root.dataset.secondaryLanguage : null;
  const bilingual = root.dataset.languageMode === "bilingual" && secondary && secondary !== primary;
  return new Set<RuntimeLanguageCode>(bilingual ? [primary, secondary] : [primary]);
}
function specificLanguage(text: string): RuntimeLanguageCode | null {
  const value = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!value || !/(name|translation|label|description|title)/i.test(value)) return null;
  for (const [code, names] of Object.entries(LANGUAGE_NAMES) as [RuntimeLanguageCode, string[]][]) {
    if (names.some((name) => value.includes(name))) return code;
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
function updateLanguageFields(root: ParentNode, active: Set<RuntimeLanguageCode>) {
  root.querySelectorAll<HTMLElement>("[data-language-code],[data-language]").forEach((element) => {
    const raw = element.dataset.languageCode || element.dataset.language || "";
    if (isSupportedRuntimeLanguage(raw)) setVisible(element, active.has(raw));
  });
  root.querySelectorAll<HTMLTableElement>("table").forEach((table) => updateTable(table, active));
  root.querySelectorAll<HTMLLabelElement>("label").forEach((label) => {
    const code = specificLanguage(label.textContent || "");
    if (!code) return;
    const host = label.closest<HTMLElement>("[data-language-field]") || label.parentElement;
    if (host) setVisible(host, active.has(code));
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
