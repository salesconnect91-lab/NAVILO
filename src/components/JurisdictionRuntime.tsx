import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/lib/supabase";
import { getJurisdictionProfile } from "@/lib/jurisdictionConfig";

const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const ATTRIBUTES = ["placeholder", "title", "aria-label"] as const;

function applyProfileText(value: string, currency: string, primaryTaxId: string, secondaryTaxId: string) {
  if (!value) return value;
  let output = value;
  output = output.replace(/\bRs\.?\s*(?=[-+(]?\d)/g, `${currency} `);
  // Foreign-currency source amounts must never be relabelled as base currency.

  const replacements: Array<[RegExp, string]> = [
    [/\bNTN\b/g, primaryTaxId],
    [/\bSTRN\b/g, secondaryTaxId || primaryTaxId],
    [/\bGSTIN\b/g, primaryTaxId],
    [/\bTRN\b/g, primaryTaxId],
    [/\bVAT Registration Number\b/g, primaryTaxId],
    [/\bVAT Number\b/g, primaryTaxId],
    [/\bVAT ID\b/g, primaryTaxId],
    [/\bBusiness Number\b/g, primaryTaxId],
    [/\bABN\b/g, primaryTaxId],
    [/\bGST Number\b/g, primaryTaxId],
    [/\bEIN\b/g, primaryTaxId],
    [/\bState Tax ID\b/g, secondaryTaxId || primaryTaxId],
    [/Tax ID \/ Registration No\./g, primaryTaxId],
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

export default function JurisdictionRuntime({children}:{children?:ReactNode}) {
  const {activeCompany}=useAuth();
  const companyId=activeCompany?.company_id;
  const [readyCompany,setReadyCompany]=useState<string|null>(null);
  const [error,setError]=useState("");
  useEffect(() => {
    let active = true;
    let observer: MutationObserver | null = null;
    let applying = false;
    let currency = "";
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
      // Jurisdiction settings are tenant-protected; do not query them from the
      // public login page. Defaults remain in effect until a session exists.
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) return;
      if (!companyId) return;
      const [settings, company] = await Promise.all([
        supabase.from("company_settings").select("country_code,currency").eq("company_id",companyId).maybeSingle(),
        supabase.from("companies").select("base_currency_code").eq("id",companyId).single()
      ]);
      if (!active) return;
      if (company.error || !company.data) {setError(company.error?.message||"Company base currency is unavailable.");return;}
      const profile = getJurisdictionProfile(settings.data?.country_code);
      currency = String(company.data.base_currency_code || "").toUpperCase();
      primaryTaxId = profile.taxIdLabels[0] || "Tax Registration Number";
      secondaryTaxId = profile.taxIdLabels[1] || "";
      apply();
      setReadyCompany(companyId);setError("");
    };

    let mutationFrame = 0;
    const pendingRoots = new Set<Node>();
    const flushMutations = () => {
      mutationFrame = 0;
      if (!active) return;
      const roots = [...pendingRoots].filter((node) => {
        let parent = node.parentNode;
        while (parent) {
          if (pendingRoots.has(parent)) return false;
          parent = parent.parentNode;
        }
        return true;
      });
      pendingRoots.clear();
      applying = true;
      roots.forEach((node) => applyTree(node, currency, primaryTaxId, secondaryTaxId));
      queueMicrotask(() => { applying = false; });
    };
    observer = new MutationObserver((mutations) => {
      if (!active || applying) return;
      for (const mutation of mutations) mutation.addedNodes.forEach((node) => pendingRoots.add(node));
      if (!mutationFrame && pendingRoots.size) mutationFrame = requestAnimationFrame(flushMutations);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    document.documentElement.dataset.naviloCurrency = "";
    const refreshSafely=()=>void refresh().catch((e:unknown)=>{if(active)setError(e instanceof Error?e.message:"Unable to load company currency.")});
    refreshSafely();
    const handleChange = refreshSafely;
    window.addEventListener("navilo-jurisdiction-changed", handleChange);
    window.addEventListener("navilo-workspace-changed", handleChange);
    return () => {
      active = false;
      observer?.disconnect();
      cancelAnimationFrame(mutationFrame);
      pendingRoots.clear();
      window.removeEventListener("navilo-jurisdiction-changed", handleChange);
      window.removeEventListener("navilo-workspace-changed", handleChange);
    };
  }, [companyId]);

  if(children&&companyId&&readyCompany!==companyId)return <p role={error?"alert":"status"}>{error||"Loading company currency…"}</p>;
  return <>{children}</>;
}
