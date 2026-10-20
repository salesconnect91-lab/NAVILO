import { describe, expect, it } from "vitest";
import { onboardingFiscalSettings, onboardingModules, suggestedOnboardingModules, requiredOnboardingModules } from "../supabase/functions/platform-admin/onboardingModules";

describe("first workspace module provisioning", () => {
  it("uses the selected modules for both company and unit and removes duplicates", () => {
    expect(onboardingModules(["dashboard", "sales", "sales"], ["dashboard", "production"], "custom"))
      .toEqual(["dashboard", "master", "accounting", "reports", "settings", "sales"]);
  });
  it("keeps manufacturing off transport and transport off other businesses", () => {
    expect(() => onboardingModules(["dashboard", "production"], [], "transport")).toThrow();
    expect(() => onboardingModules(["dashboard", "transport"], [], "retail")).toThrow();
    expect(onboardingModules(["dashboard", "transport"], [], "transport")).toContain("transport");
  });
  it("auto-includes core and service modules while rejecting unknown modules and business types", () => {
    expect(() => onboardingModules(["dashboard", "owner"], [], "custom")).toThrow();
    expect(() => onboardingModules(["dashboard"], [], "unknown")).toThrow();
    expect(onboardingModules(["transport", "master", "accounting"], [], "transport"))
      .toEqual(["dashboard", "master", "accounting", "reports", "settings", "transport"]);
  });
  it("selects steel and transport presets even if plans omit their service modules", () => {
    expect(suggestedOnboardingModules(["sales", "purchase", "inventory"], "steel"))
      .toEqual(["dashboard", "master", "accounting", "reports", "settings", "inventory", "production", "sales", "purchase"]);
    expect(suggestedOnboardingModules(["sales", "purchase", "production"], "transport"))
      .toEqual(["dashboard", "master", "accounting", "reports", "settings", "transport", "sales", "purchase"]);
  });
  it("keeps general business flexible with common accounting controls", () => {
    expect(requiredOnboardingModules("custom")).toEqual(["dashboard", "master", "accounting", "reports", "settings"]);
    expect(onboardingModules(["sales"], ["production"], "retail"))
      .toEqual(["dashboard", "master", "accounting", "reports", "settings", "sales"]);
  });

});

describe("company fiscal onboarding", () => {
  it("defaults a new Pakistani company to non-tax without a registration", () => {
    expect(onboardingFiscalSettings(undefined,undefined,undefined,undefined)).toMatchObject({
      base_currency_code:"PKR",tax_mode:"non_tax",authority_code:null,
    });
  });
  it("requires a tax effective date and authority and disallows a backdated transition", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(() => onboardingFiscalSettings("PKR","tax_registered",undefined,undefined)).toThrow();
    expect(() => onboardingFiscalSettings("PKR","tax_registered",undefined,"FBR")).toThrow("Tax effective date is required");
    expect(() => onboardingFiscalSettings("PKR","tax_registered",today,undefined)).toThrow("Tax authority is required");
    expect(() => onboardingFiscalSettings("PKR","tax_registered","2020-01-01","FBR")).toThrow();
    expect(onboardingFiscalSettings("USD","tax_registered",today,"FBR")).toMatchObject({
      base_currency_code:"USD",tax_mode:"tax_registered",tax_effective_from:today,authority_code:"FBR",
    });
  });
});
