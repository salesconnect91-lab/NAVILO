/** Validate onboarding lookup results before creating any company, branch or Auth user. */
export type LookupResult<T> = { data: T | null; error: unknown };

export type OnboardingLookupResult =
  | { ok: true }
  | { ok: false; status: 409 | 400 | 503; error: string };

export function checkOnboardingLookups(
  code: LookupResult<{ id: string }>,
  name: LookupResult<{ id: string }>,
  plan: LookupResult<{ id: string; is_active?: boolean }>,
): OnboardingLookupResult {
  if (code.error || name.error || plan.error) {
    return { ok: false, status: 503, error: "Onboarding details could not be verified" };
  }
  if (code.data || name.data) {
    return { ok: false, status: 409, error: "A company with this name or code already exists" };
  }
  // An absent active flag is unverified, not proof that the plan is active.
  if (!plan.data || !plan.data.id || plan.data.is_active !== true) {
    return { ok: false, status: 400, error: "Selected subscription plan is not active" };
  }
  return { ok: true };
}
