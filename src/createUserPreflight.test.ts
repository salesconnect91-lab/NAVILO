import { describe, expect, it } from "vitest";
import { checkCompanyUserCapacity } from "../supabase/functions/platform-admin/createUserPreflight";

const valid = { company: { max_users: 3 }, companyError: null, activeMembershipCount: 1, membershipError: null };

describe("platform create-user preflight", () => {
  it("allows a verified company with available capacity", () => {
    expect(checkCompanyUserCapacity(valid)).toEqual({ ok: true });
  });
  it("rejects a missing company before creating an auth login", () => {
    expect(checkCompanyUserCapacity({ ...valid, company: null }).ok).toBe(false);
  });
  it("fails closed when the company query fails", () => {
    expect(checkCompanyUserCapacity({ ...valid, companyError: new Error("db unavailable") }).ok).toBe(false);
  });
  it("fails closed when membership count is missing or its query fails", () => {
    expect(checkCompanyUserCapacity({ ...valid, activeMembershipCount: null }).ok).toBe(false);
    expect(checkCompanyUserCapacity({ ...valid, membershipError: new Error("db unavailable") }).ok).toBe(false);
  });
  it("rejects reached capacity", () => {
    expect(checkCompanyUserCapacity({ ...valid, activeMembershipCount: 3 })).toEqual({ ok: false, status: 409, error: "Company user limit reached" });
  });
  it("fails closed for invalid company limits and counts", () => {
    expect(checkCompanyUserCapacity({ ...valid, company: { max_users: null } }).ok).toBe(false);
    expect(checkCompanyUserCapacity({ ...valid, company: { max_users: 0 } }).ok).toBe(false);
    expect(checkCompanyUserCapacity({ ...valid, activeMembershipCount: -1 }).ok).toBe(false);
  });
});
