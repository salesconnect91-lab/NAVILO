export type DraftPreviewLine={order_id:string;amount:number|string|null;tax_percent:number|string|null;historical_vat_amount?:number|string|null};
export type DraftPreviewCharge={order_id:string;amount:number|string|null;tax_percent:number|string|null};
const cents=(v:number)=>Math.round((v+Number.EPSILON)*100)/100;
/** Display-only draft gross totals. Never post journals or adjust balances from a preview. */
export function draftInvoicePreviewTotals(lines:DraftPreviewLine[],charges:DraftPreviewCharge[]):Map<string,number>{
 const result=new Map<string,number>();
 for(const row of [...lines,...charges]){
  const amount=Number(row.amount??0), rate=Number(row.tax_percent??0);
  if(!Number.isFinite(amount)||!Number.isFinite(rate))continue;
  const historical='historical_vat_amount' in row&&row.historical_vat_amount!=null
   ?Number(row.historical_vat_amount):null;
  const vat=historical!==null&&Number.isFinite(historical)?historical:cents(amount*rate/100);
  result.set(row.order_id,cents((result.get(row.order_id)??0)+amount+vat));
 }
 return result;
}
