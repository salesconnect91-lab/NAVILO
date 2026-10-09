const number=(value:unknown)=>Number(value??0);
export const tripAmountColumns=['Agreed customer rate','Customer charges','Agreed supplier rent','Supplier charges','Posted revenue net','Posted supplier cost net','Posted other cost net','Posted contribution','Margin %','Customer received gross','Customer outstanding gross','Customer credit gross','Supplier paid gross','Supplier outstanding gross','Supplier credit gross'];
export const tripAmountKeys=['customer_rate','customer_charges','agreed_supplier_rent','supplier_charges','billed_customer_net','billed_supplier_net','other_cost_net','profit','margin','customer_received_gross','customer_outstanding_gross','customer_credit_gross','supplier_paid_gross','supplier_outstanding_gross','supplier_credit_gross'];
export function tripAmounts(row:Record<string,unknown>,total=false){
 const revenue=number(row.billed_customer_net??row.revenue);
 const profit=total?number(row.profit):revenue-number(row.billed_supplier_net)-number(row.driver_accrued)-number(row.other_cost_net);
 return tripAmountKeys.map(key=>key==='profit'?profit:key==='margin'?(revenue?profit/revenue*100:0):key==='billed_customer_net'?revenue:key==='supplier_paid_gross'?number(row.supplier_paid_gross??row.payment_amount):number(row[key]));
}
