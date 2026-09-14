import { useEffect } from "react";
import { isSupportedRuntimeLanguage, type RuntimeLanguageCode } from "@/lib/languageConfig";

const LANGUAGE_NAMES: Record<RuntimeLanguageCode, string[]> = {
  en: ["english"],
  ur: ["urdu", "اردو"],
  ar: ["arabic", "العربية"],
  hi: ["hindi", "हिन्दी", "हिंदी"],
  bn: ["bengali", "bangla", "বাংলা"],
  pa: ["punjabi", "ਪੰਜਾਬੀ", "پنجابی"],
  zh: ["chinese", "中文"],
  es: ["spanish", "español"],
  fr: ["french", "français"],
  de: ["german", "deutsch"],
  pt: ["portuguese", "português"],
  ru: ["russian", "русский"],
  ja: ["japanese", "日本語"],
  ko: ["korean", "한국어"],
  tr: ["turkish", "türkçe"],
};

const HIDDEN_ATTR = "data-navilo-language-hidden";

function selectedLanguages() {
  const root = document.documentElement;
  const primary = isSupportedRuntimeLanguage(root.dataset.primaryLanguage) ? root.dataset.primaryLanguage : "en";
  const secondary = isSupportedRuntimeLanguage(root.dataset.secondaryLanguage) ? root.dataset.secondaryLanguage : null;
  const mode = root.dataset.languageMode === "bilingual" && secondary ? "bilingual" : "single";
  return new Set<RuntimeLanguageCode>(mode === "bilingual" && secondary ? [primary, secondary] : [primary]);
}

function specificLanguage(text: string): RuntimeLanguageCode | null {
  const value = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!value) return null;
  const fieldHint = /(name|translation|label|description|title)/i.test(value);
  if (!fieldHint) return null;
  for (const [code, names] of Object.entries(LANGUAGE_NAMES) as [RuntimeLanguageCode, string[]][]) {
    if (names.some((name) => value.includes(name.toLowerCase()))) return code;
  }
  return null;
}

function setVisible(element: HTMLElement, visible: boolean) {
  if (visible) {
    if (element.getAttribute(HIDDEN_ATTR) === "true") {
      element.hidden = false;
      element.removeAttribute(HIDDEN_ATTR);
    }
    return;
  }
  element.hidden = true;
  element.setAttribute(HIDDEN_ATTR, "true");
}

function updateTable(table: HTMLTableElement, active: Set<RuntimeLanguageCode>) {
  const headerRow = table.tHead?.rows?.[0] ?? table.querySelector("tr");
  if (!headerRow) return;
  [...headerRow.cells].forEach((cell, index) => {
    const code = specificLanguage(cell.textContent || "");
    if (!code) return;
    const visible = active.has(code);
    for (const row of [...table.rows]) {
      const target = row.cells[index] as HTMLElement | undefined;
      if (target) setVisible(target, visible);
    }
  });
}

function updateLanguageFields(root: ParentNode, active: Set<RuntimeLanguageCode>) {
  root.querySelectorAll<HTMLElement>("[data-language-code],[data-language]").forEach((element) => {
    const raw = element.dataset.languageCode || element.dataset.language || "";
    if (!isSupportedRuntimeLanguage(raw)) return;
    setVisible(element, active.has(raw));
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
        // Language administration must remain fully visible so enabled languages can still be managed.
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

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("navilo-language-changed", apply);
      window.removeEventListener("navilo:language-changed", apply);
      window.removeEventListener("navilo-workspace-changed", apply);
    };
  }, []);
  return null;
}
