/** Manual Journal accepts any active posting account explicitly enabled for
 * manual entries. Source-document and account-control safeguards remain separate.
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
  return true;
}

/** Keep posting accounts searchable, but omit group/header rows from journal choices. */
export function isManualJournalAccountVisible(account: ManualJournalAccount): boolean {
  return !account.is_group;
}

/** Explains why an otherwise valid COA account cannot be posted manually. */
export function manualJournalAccountRestriction(account: ManualJournalAccount): string | null {
  if (account.is_group) return 'Group account · choose a posting account';
  if (!account.is_active) return 'Inactive account';
  if (!account.allow_manual_entries) return 'Manual entries disabled';
  return null;
}
