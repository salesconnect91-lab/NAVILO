/**
 * Fail-closed checks to run BEFORE auth.admin.createUser in platform-admin.
 * This module has no service-role credentials and never creates or modifies users.
 */
export type CompanyUserCapacity = {
  company: { max_users: number | null } | null;
  companyError: unknown;
  activeMembershipCount: number | null;
  membershipError: unknown;
};

export type UserPreflightResult =
  | { ok: true }
  | { ok: false; status: 400 | 409 | 503; error: string };

export function checkCompanyUserCapacity(input: CompanyUserCapacity): UserPreflightResult {
  if (input.companyError || !input.company) {
    return { ok: false, status: 400, error: "Company could not be verified" };
  }
  if (input.membershipError || input.activeMembershipCount === null ||
      !Number.isSafeInteger(input.activeMembershipCount) || input.activeMembershipCount < 0) {
    return { ok: false, status: 503, error: "Company user count could not be verified" };
  }
  const maxUsers = input.company.max_users;
  if (typeof maxUsers !== "number" || !Number.isSafeInteger(maxUsers) || maxUsers < 1) {
    return { ok: false, status: 503, error: "Company user limit could not be verified" };
  }
  if (input.activeMembershipCount >= maxUsers) {
    return { ok: false, status: 409, error: "Company user limit reached" };
  }
  return { ok: true };
}
