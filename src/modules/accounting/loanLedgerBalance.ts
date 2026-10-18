/** Posted loan transactions must carry each lender's independent running liability,
 * even when the user searches the displayed list. Search never recalculates history.
 */
export type LoanMovement={id:string;lender_id:string;transaction_type:'loan_received'|'loan_repayment';amount:number;transaction_date:string;created_at:string;reference?:string|null;notes?:string|null};
export type LoanBalanced<T extends LoanMovement>=T&{balance:number};
export function loanRunningBalances<T extends LoanMovement>(rows:readonly T[]):LoanBalanced<T>[]{
 const latest=new Map<string,number>();
 return [...rows].sort((a,b)=>a.transaction_date.localeCompare(b.transaction_date)||a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id))
 .map(row=>{
  const next=(latest.get(row.lender_id)||0)+(row.transaction_type==='loan_received'?Number(row.amount):-Number(row.amount));
  latest.set(row.lender_id,next);
  return {...row,balance:next};
 });
}
export function filterLoanRunningBalances<T extends LoanMovement>(rows:readonly LoanBalanced<T>[],lenderId:string,search:string,names:ReadonlyMap<string,string>):LoanBalanced<T>[]{
 const q=search.trim().toLocaleLowerCase();
 return rows.filter(row=>(!lenderId||row.lender_id===lenderId)&&(!q||
   [row.reference,row.notes,names.get(row.lender_id)].some(v=>String(v??'').toLocaleLowerCase().includes(q))));
}
