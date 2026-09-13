import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { JURISDICTIONS, getJurisdictionProfile } from "@/lib/jurisdictionConfig";

const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const ATTRIBUTES = ["placeholder", "title", "aria-label"] as const;
const currencyCodes = Array.from(new Set(JURISDICTIONS.map((item) => item.currency)));
const currencyPattern = new RegExp(`\\b(?:${currencyCodes.join("|")}|PKR)\\b(?=\\s*[-+(]?\\d)`, "g");

function applyProfileText(value: string, currency: string, primaryTaxId: string, secondaryTaxId: string) {
  if (!value) return value;
  let output = value;
  output = output.replace(/\\bRs\\.?\\s*(?=[-+(]?\\d)/g, `${currency} `);
  output = output.replace(currencyPattern, currency);

  const replacements: Array<[RegExp, string]> = [
    [/\\bNTN\\b/g, primaryTaxId],
    [/\\bSTRN\\b/g, secondaryTaxId || primaryTaxId],
    [/\\bGSTIN\\b/g, primaryTaxId],
    [/\\bTRN\\b/g, primaryTaxId],
    [/\\bVAT Registration Number\\b/g, primaryTaxId],
    [/\\bVAT Number\\b/g, primaryTaxId],
    [/\\bVAT ID\\b/g, primaryTaxId],
    [/\\bBusiness Number\\b/g, primaryTaxId],
    [/\\bABN\\b/g, primaryTaxId],
    [/\\bGST Number\\b/g, primaryTaxId],
    [/\\bEIN\\b/g, primaryTaxId],
    [/\\bState Tax ID\\b/g, secondaryTaxId || primaryTaxId],
    [/Tax ID \/ Registration No\\./g, primaryTaxId],
    [/Secondary Tax Registration/g, secondaryTaxId || primaryTaxId],
  ];
  for (const [pattern, replacement] of replacements) output = output.replace(pattern, replacement);
  return output;
}

function processTextNode(node: Text, currency: string, primaryTaxId: string, secondaryTaxId: string) {
  const parent = node.parentElement;
  if (!parent || parent.closest("script,style,code,pre,[data-jurisdiction-skip='true']")) return;
  const current = node.nodeValue || "";
  if (!current.trim()) return;

  const previousSource = originalText.get(node);
  if (!previousSource) originalText.set(node, current);
  const source = originalText.get(node) || current;
  const expected = applyProfileText(source, currency, primaryTaxId, secondaryTaxId);

  // React may reuse the same Text node for a changed amount/status. Preserve the
  // new source instead of restoring a stale value from the first render.
  if (previousSource && current !== source && current !== expected) {
    originalText.set(node, current);
    const next = applyProfileText(current, currency, primaryTaxId, secondaryTaxId);
    if (node.nodeValue !== next) node.nodeValue = next;
    return;
  }
  if (node.nodeValue !== expected) node.nodeValue = expected;
}

function processAttributes(element: Element, currency: string, primaryTaxId: string, secondaryTaxId: string) {
  if (element.closest("[data-jurisdiction-skip='true']")) return;
  let stored = originalAttributes.get(element);
  if (!stored) { stored = new Map(); originalAttributes.set(element, stored); }
  for (const attribute of ATTRIBUTES) {
    const current = element.getAttribute(attribute);
    if (!current) continue;
    const previousSource = stored.get(attribute);
    if (!previousSource) stored.set(attribute, current);
    const source = stored.get(attribute) || current;
    const expected = applyProfileText(source, currency, primaryTaxId, secondaryTaxId);
    if (previousSource && current !== source && current !== expected) stored.set(attribute, current);
    const latestSource = stored.get(attribute) || current;
    const next = applyProfileText(latestSource, currency, primaryTaxId, secondaryTaxId);
    if (current !== next) element.setAttribute(attribute, next);
  }
}

function applyTree(root: Node, currency: string, primaryTaxId: string, secondaryTaxId: string) {
  if (root.nodeType === Node.TEXT_NODE) processTextNode(root as Text, currency, primaryTaxId, secondaryTaxId);
  if (root.nodeType === Node.ELEMENT_NODE) processAttributes(root as Element, currency, primaryTaxId, secondaryTaxId);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeType === Node.TEXT_NODE) processTextNode(node as Text, currency, primaryTaxId, secondaryTaxId);
    else processAttributes(node as Element, currency, primaryTaxId, secondaryTaxId);
  }
}

export default function JurisdictionRuntime() {
  useEffect(() => {
    let active = true;
    let observer: MutationObserver | null = null;
    let applying = false;
    let currency = "PKR";
    let primaryTaxId = "NTN";
    let secondaryTaxId = "STRN";

    const apply = () => {
      if (!active) return;
      applying = true;
      document.documentElement.dataset.naviloCurrency = currency;
      document.documentElement.dataset.naviloTaxIdPrimary = primaryTaxId;
      document.documentElement.dataset.naviloTaxIdSecondary = secondaryTaxId;
      applyTree(document.body, currency, primaryTaxId, secondaryTaxId);
      queueMicrotask(() => { applying = false; });
    };

    const refresh = async () => {
      const { data, error } = await supabase.from("company_settings").select("country_code,currency").maybeSingle();
      if (error || !data) return;
      const profile = getJurisdictionProfile(data.country_code);
      currency = String(data.currency || profile.currency || "USD").toUpperCase();
      primaryTaxId = profile.taxIdLabels[0] || "Tax Registration Number";
      secondaryTaxId = profile.taxIdLabels[1] || "";
      apply();
    };

    observer = new MutationObserver((mutations) => {
      if (!active || applying) return;
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => applyTree(node, currency, primaryTaxId, secondaryTaxId));
        if (mutation.type === "characterData" && mutation.target.nodeType === Node.TEXT_NODE) processTextNode(mutation.target as Text, currency, primaryTaxId, secondaryTaxId);
        if (mutation.type === "attributes" && mutation.target.nodeType === Node.ELEMENT_NODE) processAttributes(mutation.target as Element, currency, primaryTaxId, secondaryTaxId);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRIBUTES] });

    void refresh();
    const handleChange = () => void refresh();
    window.addEventListener("navilo-jurisdiction-changed", handleChange);
    window.addEventListener("navilo-workspace-changed", handleChange);
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener("navilo-jurisdiction-changed", handleChange);
      window.removeEventListener("navilo-workspace-changed", handleChange);
    };
  }, []);

  return null;
}
