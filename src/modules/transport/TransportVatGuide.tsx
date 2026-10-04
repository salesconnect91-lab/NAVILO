export default function TransportVatGuide(){return <details className="my-2 rounded border border-blue-200 bg-blue-50 p-2 text-xs"><summary className="cursor-pointer font-semibold">VAT, corrections and payment reversals</summary><div className="mt-2 space-y-1">
<p>Rates/rents and Trip profit exclude VAT. Receipts, payments, outstanding and refunds include VAT. Posted invoice tax is historical; changing tax settings does not rewrite it.</p>
<p>Customer: With VAT posts a Sales Tax Invoice. Supplier: With VAT records a Purchase Tax Invoice; enter the original supplier invoice reference and use its date. Tax identity and the effective rate are checked on posting.</p>
<p>Trip Finance → Correct Rate: a decrease creates a customer credit note or supplier debit note with source VAT. An increase creates an additional invoice/bill using the adjustment date. Review the separate document and journal in correction history.</p>
<p>Wrong payment/receipt: use <a className="font-semibold text-blue-700 underline" href="/accounting/payment-reversals">Payment Reversals</a>. This restores invoice allocation/outstanding; it does not cancel the invoice or its VAT.</p>
<p>Overpayment/credit: use Trip Finance → Refund Credit / Recover Credit. Use invoice-wise outstanding below for Net, VAT, Gross, paid and credit balances after notes.</p>
<p><a className="text-blue-700 underline" href="/accounting/returns">Open posted credit/debit notes</a> · Original posted invoices remain locked. Supplier and customer are independent—one side's VAT choice does not change the other.</p>
</div></details>}
