import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const handler = readFileSync(new URL("../supabase/functions/platform-admin/index.ts", import.meta.url), "utf8");
const onboarding = handler.split('if (action === "onboard_company") {')[1]?.split('if (action === "create_user") {')[0] ?? "";

describe("platform-admin onboarding handler regression guard", () => {
  it("checks all lookup errors and rejects unverified plans before creating a company or Auth user", () => {
    expect(onboarding).not.toBe("");
    const firstWrite = onboarding.indexOf('admin.from("companies").insert(');
    const authWrite = onboarding.indexOf("admin.auth.admin.createUser(");
    expect(firstWrite).toBeGreaterThan(0);
    expect(authWrite).toBeGreaterThan(firstWrite);
    const beforeWrite = onboarding.slice(0, firstWrite);
    expect(beforeWrite).toMatch(/checkOnboardingLookups\(codeLookup,\s*nameLookup,\s*planLookup\)/);
    expect(beforeWrite).toMatch(/if\s*\(!preflight\.ok\)\s*return\s+json\(/);
    expect(beforeWrite).toMatch(/preflight\.status/);
    expect(beforeWrite).toMatch(/const plan\s*=\s*planLookup\.data/);
    expect(beforeWrite).toMatch(/subscription_plans[\s\S]*?\.maybeSingle\(\)/);
  });
});
