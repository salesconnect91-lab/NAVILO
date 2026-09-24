import { describe, expect, it } from "vitest";
import { onboardingModules } from "../supabase/functions/platform-admin/onboardingModules";

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
