/**
 * Shared Transport company-fleet rules, not tied to any one tenant.
 *
 * Historical Trip owner identity takes precedence over a vehicle's current
 * Master ownership. Never classify a named supplier/partner's Trip as the
 * company's own merely because a vehicle was later bought by the company.
 */
export const normalizeOwner = (value: unknown): string =>
  String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

const COMPANY_ALIASES = new Set(['self', 'own', 'own vehicle', 'company', 'company owned']);
const COMPANY_CLASSES = new Set(['company', 'company owned', 'owned', 'self']);
const EXTERNAL_CLASSES = new Set([
  'supplier', 'supplier owned', 'partner', 'partner owned',
  'hired', 'third party', 'external',
]);
const GENERIC_FIRST_WORDS = new Set(['transport', 'company', 'saudi', 'rental', 'al']);

export function isCompanyFleetTrip(owner: unknown, ownershipClass: unknown, companyName: string): boolean {
  const classification = normalizeOwner(ownershipClass);
  // An explicit supplier/partner ownership class always wins.
  if (EXTERNAL_CLASSES.has(classification)) return false;

  const snapshot = normalizeOwner(owner);
  if (COMPANY_ALIASES.has(snapshot)) return true;

  // A recorded, nonempty owner identifies the historical Trip even if the
  // current vehicle Master is company-owned. Never override that evidence.
  if (snapshot) {
    const name = normalizeOwner(companyName);
    if (!name) return false;
    if (snapshot === name) return true;
    if (snapshot.length >= 5 && name.startsWith(snapshot + ' ')) return true;
    // Legacy source often uses the distinctive first trading-name word.
    const first = name.split(' ')[0];
    return first.length >= 5 && !GENERIC_FIRST_WORDS.has(first) && snapshot === first;
  }

  // Only fall back to historical ownership classification when the Trip has
  // no named owner, rather than relying on today's vehicle Master.
  return COMPANY_CLASSES.has(classification);
}
