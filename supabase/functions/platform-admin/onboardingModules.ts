export const MODULE_KEYS = ["dashboard", "master", "sales", "purchase", "inventory", "production", "transport", "accounting", "reports", "settings"] as const;
export const BUSINESS_TYPES = ["steel", "transport", "retail", "fuel", "construction", "custom"] as const;

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
