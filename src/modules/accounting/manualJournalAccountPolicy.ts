/** Manual Journal is for balance-sheet entries and controlled adjustments.
 * Income, expense and VAT billing belong to source-document workflows.
 * This helper governs the manual editor; source-generated journals are unaffected.
 */
export type ManualJournalAccount = {
  is_active: boolean;
  is_group: boolean;
  allow_manual_entries: boolean;
  type: string;
  code?: string | null;
  name?: string | null;
};
export function isManualJournalAccountEligible(account: ManualJournalAccount): boolean {
  if (!account.is_active || account.is_group || !account.allow_manual_entries) return false;
  if (['revenue','income','expense'].includes(String(account.type).toLowerCase())) return false;
  if (['1150','2120'].includes(String(account.code ?? '').trim())) return false;
  if (/\b(input|output)\s+vat\b/i.test(account.name ?? '')) return false;
  return true;
}
