import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const handler = readFileSync(new URL("../supabase/functions/platform-admin/index.ts", import.meta.url), "utf8");
const createUser = handler.split('if (action === "create_user") {')[1]?.split('if (action === "create_company") {')[0] ?? "";

describe("platform-admin create_user handler regression guard", () => {
  it("verifies company and membership query errors before creating an auth login", () => {
    expect(createUser).not.toBe("");
    const createAuthAt = createUser.indexOf("admin.auth.admin.createUser(");
    expect(createAuthAt).toBeGreaterThan(0);
    const beforeAuth = createUser.slice(0, createAuthAt);
    expect(beforeAuth).toMatch(/companyResult\.error\s*\|\|\s*!companyResult\.data/);
    expect(beforeAuth).toMatch(/membershipResult\.error\s*\|\|\s*membershipResult\.count\s*===\s*null/);
    expect(beforeAuth).toMatch(/Number\.isSafeInteger\(maxUsers\)/);
    expect(beforeAuth).toMatch(/membershipResult\.count\s*>=\s*maxUsers/);
  });
});
