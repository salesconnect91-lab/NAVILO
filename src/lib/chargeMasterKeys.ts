export type ChargeScope = "sales" | "purchase" | "both";
export type ExistingChargeKey = { id?: string; charge_key: string; charge_name: string; applies_to: ChargeScope };

export const makeChargeKey = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const scopesOverlap = (a: ChargeScope, b: ChargeScope) => a === b || a === "both" || b === "both";

/** Same charge name on opposite sides is allowed; overlapping sides are not. */
export function overlappingCharge(
  rows: readonly ExistingChargeKey[], name: string, scope: ChargeScope, excludeId?: string | null,
): ExistingChargeKey | undefined {
  const normalized = makeChargeKey(name);
  return rows.find(row => row.id !== excludeId &&
    makeChargeKey(row.charge_name) === normalized && scopesOverlap(row.applies_to, scope));
}

/** Existing keys stay immutable on edit; new opposite-side keys must be distinct. */
export function availableChargeKey(name: string, scope: ChargeScope, rows: readonly ExistingChargeKey[]): string {
  const base = makeChargeKey(name);
  if (!base) throw new Error("Valid Charge Name is required.");
  const existing = new Set(rows.map(row => row.charge_key));
  if (!existing.has(base)) return base;
  const scoped = `${base}_${scope}`;
  if (!existing.has(scoped)) return scoped;
  for (let n = 2; n <= 10000; n++) {
    const candidate = `${scoped}_${n}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error("Too many charges with similar keys. Contact support.");
}

export function chargeWriteError(error: {code?: string; message: string}): string {
  return error.code === "23505" || /duplicate key value.*(charge_master|charge_key)/i.test(error.message)
    ? "This charge key already exists. Refresh Charge Master and check the existing Sales/Purchase charge before saving again."
    : error.message;
}
