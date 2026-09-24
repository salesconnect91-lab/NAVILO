export const MODULE_KEYS = ["dashboard", "master", "sales", "purchase", "inventory", "production", "transport", "accounting", "reports", "settings"] as const;
export const BUSINESS_TYPES = ["steel", "transport", "retail", "fuel", "construction", "custom"] as const;
export const BASE_CURRENCIES = ["PKR", "USD", "EUR", "GBP", "SAR", "AED"] as const;

export function onboardingFiscalSettings(baseCurrency: unknown, taxMode: unknown, effectiveFrom: unknown, authority: unknown) {
  const currency = String(baseCurrency || "PKR").toUpperCase();
  if (!(BASE_CURRENCIES as readonly string[]).includes(currency)) throw new Error("Select a supported base currency");
  const mode = String(taxMode || "non_tax");
  if (mode !== "non_tax" && mode !== "tax_registered") throw new Error("Invalid company tax mode");
  const date = String(effectiveFrom || new Date().toISOString().slice(0, 10));
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0,10)!==date || date < new Date().toISOString().slice(0, 10))
    throw new Error("Tax effective date must be today or later");
  const authorityCode = String(authority || "").trim().toUpperCase();
  if (mode === "tax_registered" && !authorityCode) throw new Error("Tax authority is required for a registered company");
  return { base_currency_code: currency, tax_mode: mode, tax_effective_from: date, authority_code: authorityCode || null };
}

export function onboardingModules(requested: unknown, defaults: unknown, businessType: string): string[] {
  if (!(BUSINESS_TYPES as readonly string[]).includes(businessType)) throw new Error("Invalid business type");
  const selected = Array.isArray(requested) && requested.length ? requested : defaults;
  if (!Array.isArray(selected) || !selected.length || selected.some(key => typeof key !== "string" || !(MODULE_KEYS as readonly string[]).includes(key))) {
    throw new Error("Select valid licensed modules");
  }
  const modules = [...new Set<string>(selected)];
  if (!modules.includes("dashboard")) throw new Error("Dashboard must be enabled");
  if (businessType === "transport" && modules.includes("production")) throw new Error("Production is unavailable for a transport workspace");
  if (businessType !== "transport" && modules.includes("transport")) throw new Error("Transport requires a transport workspace");
  return modules;
}
