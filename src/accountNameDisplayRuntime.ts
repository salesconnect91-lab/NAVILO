// Account selectors may render codes as "1120 Bank" as well as "1120 - Bank".
// This pattern is applied only after an account-select context check, not to business data.
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

  let node: HTMLElement | null = select.parentElement;
  for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
    const labels = Array.from(node.querySelectorAll("label"))
      .slice(0, 6)
      .map((label) => label.textContent || "")
      .join(" ");
    if (looksLikeAccountHint(labels)) return true;
  }

  const coded = Array.from(select.options).filter((option) => ACCOUNT_CODE.test(option.textContent || ""));
  const nonEmpty = Array.from(select.options).filter((option) => option.value && (option.textContent || "").trim());
  const uuidValues = nonEmpty.filter((option) => /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(option.value));
  return nonEmpty.length >= 2 && coded.length >= Math.max(2, Math.ceil(nonEmpty.length * 0.7)) && uuidValues.length >= Math.ceil(nonEmpty.length * 0.7);
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
