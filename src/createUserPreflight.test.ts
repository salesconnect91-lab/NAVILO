import { describe, expect, it } from "vitest";
import { checkCompanyUserCapacity } from "../supabase/functions/platform-admin/createUserPreflight";

const valid = { company: { max_users: 3 }, companyError: null, activeMembershipCount: 1, membershipError: null };

describe("platform create-user preflight", () => {
  it("allows a verified company with available capacity", () => {
    expect(checkCompanyUserCapacity(valid)).toEqual({ ok: true });
  });
  it("rejects a missing company before creating an auth login", () => {
    expect(checkCompanyUserCapacity({ ...valid, company: null })).toEqual({ ok: false, status: 404, error: "Company could not be verified" });
  });
  it("fails closed with a service error when the company query fails", () => {
    expect(checkCompanyUserCapacity({ ...valid, companyError: new Error("db unavailable") })).toEqual({ ok: false, status: 503, error: "Company could not be verified" });
  });
  it("fails closed when membership count is missing or its query fails", () => {
    const failure = { ok: false, status: 503, error: "Company user count could not be verified" };
    expect(checkCompanyUserCapacity({ ...valid, activeMembershipCount: null })).toEqual(failure);
    expect(checkCompanyUserCapacity({ ...valid, membershipError: new Error("db unavailable") })).toEqual(failure);
    expect(checkCompanyUserCapacity({ ...valid, activeMembershipCount: Number.NaN })).toEqual(failure);
    expect(checkCompanyUserCapacity({ ...valid, activeMembershipCount: -1 })).toEqual(failure);
  });
  it("rejects reached capacity", () => {
    expect(checkCompanyUserCapacity({ ...valid, activeMembershipCount: 3 })).toEqual({ ok: false, status: 409, error: "Company user limit reached" });
  });
  it("fails closed for invalid company limits", () => {
    const failure = { ok: false, status: 503, error: "Company user limit could not be verified" };
    expect(checkCompanyUserCapacity({ ...valid, company: { max_users: null } })).toEqual(failure);
    expect(checkCompanyUserCapacity({ ...valid, company: { max_users: 0 } })).toEqual(failure);
    expect(checkCompanyUserCapacity({ ...valid, company: { max_users: Number.NaN } })).toEqual(failure);
  });
});
