import {Link} from 'react-router-dom';
import {useAuth} from '@/auth/AuthContext';
export default function ProfitDistributionSettings(){
 const {activeBusinessUnit}=useAuth();
 if(activeBusinessUnit?.business_unit_type!=='transport')return <p>Profit distribution guide is available in Transport business units.</p>;
 return <section className="space-y-3 rounded border bg-white p-3 text-sm">
  <h1 className="text-base font-semibold">Profit Distribution · Journal Entries</h1>
  <p>Review the month, calculate agreed partner shares, and post one balanced journal. There is no separate automatic distribution workflow.</p>
  <ol className="list-decimal space-y-2 pl-5">
   <li>Review posted Profit &amp; Loss and company vehicle income and expenses. Reconcile shared expenses before calculating net profit.</li>
   <li>Debit the appropriate profit equity account and credit each partner Current Account for the agreed share. Record the profit month and calculation reference in the description.</li>
   <li>For historical opening profit, use its existing Undistributed Profit account. Do not record it again as income.</li>
   <li>Check previous journals, source balance and partner ledgers before posting. A manual journal does not automatically calculate shares or prevent a second distribution for the same month.</li>
  </ol>
  <p className="rounded border bg-amber-50 p-2">Partner distribution preserves the income, expense and vehicle history. It does not close income/expense accounts. Future monthly earnings need a reconciled equity appropriation treatment; do not assume that posted P&amp;L is already a posted Undistributed Profit balance.</p>
  <div className="flex flex-wrap gap-3"><Link className="text-blue-700 underline" to="/accounting">Journal Entries</Link><Link className="text-blue-700 underline" to="/accounting/profit-loss">Profit &amp; Loss</Link><Link className="text-blue-700 underline" to="/accounting/ledgers">General Ledgers</Link><Link className="text-blue-700 underline" to="/transport?view=vehicle-account">Company Vehicle Ledger</Link></div>
 </section>;
}
