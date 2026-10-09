/**
 * Financial-statement presentation only.
 * Never change GL type, normal balance, journal values, or accounting scope.
 * The report groups by the canonical account type and period; this helper
 * provides readable categories and stable intra-section ordering.
 */
function norm(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function balanceSheetClassification(
  accountType: string,
  rawDetailType: string | null | undefined,
  accountName: string,
): {label: string; rank: number} {
  const name = accountName.toLowerCase();
  const key = norm(rawDetailType);

  if (accountType === 'liability') {
    if (name.includes('salary running account') || name.includes('salary balance')) {
      return {label:'Salary Running Account',rank:35};
    }
    if (name.includes('customer advance'))return {label:'Customer Advances',rank:15};
    if (name.includes('running payable'))return {label:'Running Payable',rank:20};
    if (name.includes('salary payable') || name.includes('driver payable'))return {label:'Salary Payable',rank:35};
    if (name.includes('loan payable') || key.includes('longtermloan') || key.includes('noncurrent'))return {label:'Long-Term Loan',rank:70};
    if (key==='accountspayable')return {label:'Trade Payable',rank:10};
    if (name.includes('payable'))return {label:'Other Payable',rank:40};
    if (key==='shorttermloan')return {label:'Short-Term Loan',rank:25};
    if (key.includes('currentliabilit'))return {label:'Other Current Liability',rank:50};
  }

  if (accountType === 'equity') {
    if (name.includes('current account'))return {label:'Partner Current Account',rank:20};
    if (name.includes('undistributed profit'))return {label:'Undistributed Profit',rank:30};
    if (name.includes('retained earnings') || key==='retainedearnings')return {label:'Retained Earnings',rank:40};
    if (name.includes('capital') || key==='capital' || key==='ownersequity')return {label:'Partner Capital',rank:10};
    if (key==='ownersdrawings')return {label:'Owner Drawings',rank:50};
    return {label:'Other Equity',rank:60};
  }

  if (accountType === 'asset') {
    if (key==='cash' || key==='cashandcashequivalents' || key==='bank')return {label:'Cash & Bank',rank:10};
    if (key==='othercurrentasset')return {label:'Other Current Asset',rank:60};
    if (key==='accountsreceivable')return {label:'Trade Receivables',rank:20};
    if (name.includes('investment') || key.includes('noncurrentasset'))return {label:'Investments / Long-Term Assets',rank:70};
    if (key==='fixedassets' || name.includes('machinery') || name.includes('equipment'))return {label:'Property & Equipment',rank:80};
    if (name.includes('loan') || name.includes('receivable') || key.includes('currentasset'))return {label:'Other Receivables',rank:30};
    if (key==='inventory')return {label:'Inventory',rank:40};
    if (key==='inputvat')return {label:'Input VAT',rank:50};
  }

  // Unrecognized or custom COA detail types must still be readable.
  const cleaned = (rawDetailType??'').trim()
    .replace(/_/g,' ').replace(/-/g,' ')
    .replace(/([a-z])([A-Z])/g,'$1 $2')
    .replace(/\s+/g,' ');
  return {label:cleaned ? cleaned.replace(/\b\w/g,ch=>ch.toUpperCase()) : 'General',rank:90};
}

/** Sort readable categories together; then sort account names inside each category. */
export function compareBalanceSheetPresentation(
  a:{name:string;detailType?:string;amount:number},
  b:{name:string;detailType?:string;amount:number},
  accountType:'asset'|'liability'|'equity',
):number {
  const aa=balanceSheetClassification(accountType,a.detailType,a.name);
  const bb=balanceSheetClassification(accountType,b.detailType,b.name);
  return aa.rank-bb.rank ||
    aa.label.localeCompare(bb.label,'en',{numeric:true}) ||
    a.name.localeCompare(b.name,'en',{numeric:true});
}
