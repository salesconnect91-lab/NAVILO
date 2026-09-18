import { describe, expect, it } from "vitest";
import { checkOnboardingLookups } from "../supabase/functions/platform-admin/onboardingPreflight";

const absent = { data: null, error: null };
const validPlan = { data: { id: "plan-1", is_active: true }, error: null };

describe("platform onboarding lookup preflight", () => {
  it("allows a new company with a verified active plan", () => {
    expect(checkOnboardingLookups(absent, absent, validPlan)).toEqual({ ok: true });
  });
  it.each(["code", "name", "plan"])("fails closed when the %s lookup errors", (lookup) => {
    const failed = { data: null, error: new Error("database unavailable") };
    const result = checkOnboardingLookups(
      lookup === "code" ? failed : absent,
      lookup === "name" ? failed : absent,
      lookup === "plan" ? failed : validPlan,
    );
    expect(result).toMatchObject({ ok: false, status: 503 });
  });
  it("rejects duplicate company codes and names", () => {
    const duplicate = { data: { id: "company-1" }, error: null };
    expect(checkOnboardingLookups(duplicate, absent, validPlan)).toMatchObject({ ok: false, status: 409 });
    expect(checkOnboardingLookups(absent, duplicate, validPlan)).toMatchObject({ ok: false, status: 409 });
  });
  it("rejects missing, inactive or unverified plans", () => {
    expect(checkOnboardingLookups(absent, absent, absent)).toMatchObject({ ok: false, status: 400 });
    expect(checkOnboardingLookups(absent, absent, { data: { id: "plan-1", is_active: false }, error: null })).toMatchObject({ ok: false, status: 400 });
    expect(checkOnboardingLookups(absent, absent, { data: { id: "plan-1" }, error: null })).toMatchObject({ ok: false, status: 400 });
    expect(checkOnboardingLookups(absent, absent, { data: { id: "", is_active: true }, error: null })).toMatchObject({ ok: false, status: 400 });
  });
});
