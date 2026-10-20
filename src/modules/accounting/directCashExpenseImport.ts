/** Pure, reusable validation for supplier-less direct Cash/Bank expenses.
 * No VAT is claimed here: recoverable tax uses supplier tax invoice workflow. */
export type DirectCashExpenseRow={
  transaction_date:string;expense_area:"office"|"yard"|"general";
  expense_account_id:string;cash_bank_account_id:string;
  paid_to:string;description:string;amount:number;source_reference:string;
};
export type DirectCashAccount={id:string;name:string;code?:string|null;type:string;detail_type?:string|null;account_role?:string|null;is_group?:boolean;is_active?:boolean;allow_manual_entries?:boolean};
const key=(v:unknown)=>String(v??"").toLowerCase().replace(/[^a-z0-9]+/g,"");
const clean=(v:unknown)=>String(v??"").trim();
const validDate=(d:string)=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d+"T00:00:00Z").toISOString().startsWith(d);
const money=(v:unknown,row:number)=>{const x=clean(v).replaceAll(",","");if(!/^\d{1,11}(\.\d{1,2})?$/.test(x))throw Error("Row "+row+": amount must be a positive SAR number with up to 2 decimals.");const n=Number(x);if(!Number.isSafeInteger(Math.round(n*100))||n<=0)throw Error("Row "+row+": amount must be greater than zero.");return n;};
const find=(r:Record<string,unknown>,field:string)=>Object.entries(r).find(([k])=>key(k)===key(field))?.[1];
export function parseDirectCashExpenseRows(
 raw:Record<string,unknown>[],accounts:DirectCashAccount[]
):DirectCashExpenseRow[]{
 if(raw.length<1||raw.length>100)throw Error("Choose between 1 and 100 direct cash expense rows per batch.");
 const mapped=new Map<string,DirectCashAccount|null>();
 for(const a of accounts){for(const alias of [a.id,a.code||"",a.name]){if(!alias)continue;const k=key(alias);mapped.set(k,mapped.has(k)&&mapped.get(k)?.id!==a.id?null:a)}}
 const refs=new Set<string>();
 return raw.map((r,index)=>{
  const line=index+2;const get=(k:string)=>clean(find(r,k));
  const date=get("Date"),area=get("Area").toLowerCase();
  const expense=get("Expense Account"),payment=get("Cash / Bank Account"),reference=get("Source Reference"),paid_to=get("Paid To"),description=get("Description");
  if(!validDate(date))throw Error("Row "+line+": valid ISO Date YYYY-MM-DD required.");
  if(!["office","yard","general"].includes(area))throw Error("Row "+line+": Area must be Office, Yard or General. Vehicle expenses use Vehicle Expense Excel.");
  if(!description||description.length>500)throw Error("Row "+line+": Description required (max 500 characters).");
  if(!reference||reference.length>100)throw Error("Row "+line+": unique Source Reference required (max 100 characters).");
  const refKey=reference.toLowerCase();
  if(refs.has(refKey))throw Error("Row "+line+": duplicate source reference "+reference);
  refs.add(refKey);
  const debit=mapped.get(key(expense)),credit=mapped.get(key(payment));
  if(!debit||debit.type!=="expense"||debit.is_active===false||debit.is_group||debit.allow_manual_entries===false
    ||/\b(cost of goods sold|salaries)\b/i.test(debit.name)||/\b(cogs|salaries)\b/i.test(debit.detail_type||""))
   throw Error("Row "+line+": active ordinary operating Expense GL is required (not COGS or Salaries).");
  if(!credit||credit.type!=="asset"||credit.is_active===false||credit.is_group||credit.allow_manual_entries===false
    ||!["Cash on Hand","Bank Account"].includes(credit.detail_type||""))
   throw Error("Row "+line+": active Cash on Hand or Bank Account required.");
  return {transaction_date:date,expense_area:area as DirectCashExpenseRow["expense_area"],
    expense_account_id:debit.id,cash_bank_account_id:credit.id,paid_to,description,
    amount:money(find(r,"Amount SAR"),line),source_reference:reference};
 });
}
