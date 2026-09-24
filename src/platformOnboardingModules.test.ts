import { describe, expect, it } from "vitest";
import { onboardingFiscalSettings, onboardingModules } from "../supabase/functions/platform-admin/onboardingModules";

describe("first workspace module provisioning", () => {
  it("uses the selected modules for both company and unit and removes duplicates", () => {
    expect(onboardingModules(["dashboard", "sales", "sales"], ["dashboard", "production"], "custom"))
      .toEqual(["dashboard", "sales"]);
  });
  it("keeps manufacturing off transport and transport off other businesses", () => {
    expect(() => onboardingModules(["dashboard", "production"], [], "transport")).toThrow();
    expect(() => onboardingModules(["dashboard", "transport"], [], "retail")).toThrow();
    expect(onboardingModules(["dashboard", "transport"], [], "transport")).toContain("transport");
  });
  it("rejects unknown modules, business types and a missing dashboard", () => {
    expect(() => onboardingModules(["dashboard", "owner"], [], "custom")).toThrow();
    expect(() => onboardingModules(["dashboard"], [], "unknown")).toThrow();
    expect(() => onboardingModules(["sales"], [], "custom")).toThrow();
  });
});

describe("company fiscal onboarding", () => {
  it("defaults a new Pakistani company to non-tax without a registration", () => {
    expect(onboardingFiscalSettings(undefined,undefined,undefined,undefined)).toMatchObject({
      base_currency_code:"PKR",tax_mode:"non_tax",authority_code:null,
    });
  });
  it("requires a tax authority and disallows a backdated transition", () => {
    expect(() => onboardingFiscalSettings("PKR","tax_registered",undefined,undefined)).toThrow();
    expect(() => onboardingFiscalSettings("PKR","tax_registered","2020-01-01","FBR")).toThrow();
    expect(onboardingFiscalSettings("USD","tax_registered",undefined,"FBR")).toMatchObject({
      base_currency_code:"USD",tax_mode:"tax_registered",authority_code:"FBR",
    });
  });
});
