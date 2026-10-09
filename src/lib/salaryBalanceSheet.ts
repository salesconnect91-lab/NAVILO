/**
 * Salary-linked GL presentation follows the configured Chart of Accounts type,
 * not the sign of individual ledger movements. A debit balance on a Liability
 * GL is displayed as a negative liability; never create a second receivable.
 * Salary expense GLs remain in P&L, not on the Balance Sheet.
 */
export type SalarySheetPosition = {bucket:'asset'|'liability';signedAmount:number}|null;

export function salarySheetPosition(
  accountType:string,
  debit:number,
  credit:number,
):SalarySheetPosition{
  if(accountType==='liability')return {bucket:'liability',signedAmount:credit-debit};
  if(accountType==='asset')return {bucket:'asset',signedAmount:debit-credit};
  return null;
}
