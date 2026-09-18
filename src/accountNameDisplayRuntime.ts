// Account selectors may render codes as "1120 Bank" as well as "1120 - Bank".
// Never strip codes from non-account business data.
const ACCOUNT_CODE = /^\s*[A-Z]{0,4}[-/]?\d{2,10}(?:[./-]\d+)?(?:\s*[-–—:|]\s*|\s+)/;

function stripAccountCode(value: string) {
  const cleaned = value.replace(ACCOUNT_CODE, "").trim();
  return cleaned || value.trim();
}

function looksLikeAccountHint(value: string | null | undefined) {
  const text = String(value || "").toLocaleLowerCase();
  return text.includes("account") || text.includes("اکاؤنٹ") || text.includes("ledger") || text.includes("لیجر");
}

function nearbyAccountContext(select: HTMLSelectElement) {
  if (
    looksLikeAccountHint(select.name) ||
    looksLikeAccountHint(select.id) ||
    looksLikeAccountHint(select.getAttribute("aria-label")) ||
    looksLikeAccountHint(select.getAttribute("data-field"))
  ) return true;

  // Only labels associated with this select identify an account selector.
  // UUID option values and numeric-looking names are common in item/customer
  // selectors too, so their shape must never be used to infer account context.
  return Array.from(select.labels || []).some((label) => looksLikeAccountHint(label.textContent));
}

function normalizeSelect(select: HTMLSelectElement) {
  if (!nearbyAccountContext(select)) return;
  Array.from(select.options).forEach((option) => {
    const current = option.textContent || "";
    if (!ACCOUNT_CODE.test(current)) return;
    if (!option.dataset.naviloAccountLabel) option.dataset.naviloAccountLabel = current;
    option.textContent = stripAccountCode(current);
  });
}

function normalizeAccountText(root: ParentNode = document) {
  root.querySelectorAll<HTMLSelectElement>("select").forEach(normalizeSelect);
}

// Avoid rescanning every select in a large page when an unrelated text node changes.
function normalizeChangedNode(node: Node) {
  const element = node instanceof Element ? node : node.parentElement;
  if (!element) return;
  const select = element.closest("select");
  if (select instanceof HTMLSelectElement) {
    normalizeSelect(select);
    return;
  }
  if (element instanceof HTMLSelectElement) normalizeSelect(element);
  normalizeAccountText(element);
}

function start() {
  normalizeAccountText();
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        // Only changes inside options can affect account labels.
        const parent = mutation.target.parentElement;
        if (parent?.closest("select")) normalizeChangedNode(parent);
        continue;
      }
      if (mutation.type === "childList") {
        if (mutation.target instanceof HTMLOptionElement || mutation.target instanceof HTMLSelectElement) {
          normalizeChangedNode(mutation.target);
        }
        mutation.addedNodes.forEach((node) => {
          // New text outside selects cannot contain a dropdown to normalize.
          if (node instanceof Element || node.parentElement?.closest("select")) normalizeChangedNode(node);
        });
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();

export {};
