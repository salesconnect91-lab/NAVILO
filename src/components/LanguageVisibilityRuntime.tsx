import { useEffect } from "react";
import { NAVILO_LANGUAGES, isSupportedRuntimeLanguage, type RuntimeLanguageCode } from "@/lib/languageConfig";

const HIDDEN_ATTR = "data-navilo-language-hidden";
const languageNames = new Map<string, RuntimeLanguageCode>();
for (const language of NAVILO_LANGUAGES) {
  languageNames.set(language.label.toLowerCase(), language.code);
  languageNames.set(language.nativeLabel.toLowerCase(), language.code);
}
languageNames.set("हिंदी", "hi");

function selectedLanguages(): Set<RuntimeLanguageCode> {
  const root = document.documentElement;
  const primary: RuntimeLanguageCode = isSupportedRuntimeLanguage(root.dataset.primaryLanguage) ? root.dataset.primaryLanguage : "en";
  const secondary = root.dataset.secondaryLanguage;
  return new Set(root.dataset.languageMode === "bilingual" && isSupportedRuntimeLanguage(secondary) && secondary !== primary
    ? [primary, secondary] : [primary]);
}

// Match a language *field label*, never arbitrary business names or script ranges.
// Arabic, Urdu and Persian share characters and cannot be identified by Unicode block.
function fieldLanguage(text: string): RuntimeLanguageCode | null {
  const value = text.trim().toLowerCase().replace(/\s+/g, " ");
  const match = value.match(/^(?:(?:name|item name|employee name|designation|department|description|translation|label|title)\s*(?:\(|:|\-|\/)?\s*)(.+?)(?:\))?\s*$/i)
    ?? value.match(/^(.+?)\s+(?:name|translation|description|label|title)$/i);
  if (!match) return null;
  return languageNames.get(match[1].replace(/[():/\-]/g, "").trim()) ?? null;
}

function setVisible(element: HTMLElement, visible: boolean) {
  if (visible) {
    if (element.getAttribute(HIDDEN_ATTR) === "true") {
      element.hidden = false;
      element.removeAttribute(HIDDEN_ATTR);
    }
  } else if (element.getAttribute(HIDDEN_ATTR) !== "true") {
    // Only restore elements that this runtime itself hid.
    if (element.hidden) return;
    element.hidden = true;
    element.setAttribute(HIDDEN_ATTR, "true");
  }
}

function updateLanguageFields(root: ParentNode, active: Set<RuntimeLanguageCode>) {
  root.querySelectorAll<HTMLElement>("[data-language-code],[data-language]").forEach((element) => {
    const code = element.dataset.languageCode || element.dataset.language;
    if (isSupportedRuntimeLanguage(code)) setVisible(element, active.has(code));
  });
  root.querySelectorAll<HTMLTableElement>("table").forEach((table) => {
    const header = table.tHead?.rows[0];
    if (!header) return;
    [...header.cells].forEach((cell, index) => {
      const code = fieldLanguage(cell.textContent || "");
      if (!code) return;
      [...table.rows].forEach((row) => {
        const target = row.cells[index];
        if (target) setVisible(target, active.has(code));
      });
    });
  });
  root.querySelectorAll<HTMLLabelElement>("label").forEach((label) => {
    const code = fieldLanguage(label.textContent || "");
    if (!code) return;
    const host = label.closest<HTMLElement>("[data-language-field]") ?? label.parentElement;
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
