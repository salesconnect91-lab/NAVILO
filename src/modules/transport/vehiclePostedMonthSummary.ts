export type VehiclePostedMovement={
 event_date:string;
 revenue:number|string;
 cost:number|string;
 category?:string|null;
 expense_accounts?:string|null;
};
export type VehicleMonth={month:string;income:number;expenses:number;net:number;incomeEvents:number;expenseEvents:number;costDetails:{account:string;amount:number}[]};
export function groupPostedVehicleMonths(rows:readonly VehiclePostedMovement[]):VehicleMonth[]{
 const byMonth=new Map<string,{income:number;expenses:number;incomeEvents:number;expenseEvents:number;costs:Map<string,number>}>();
 for(const row of rows){
  const date=String(row.event_date??'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Invalid posted vehicle movement date.');
  const income=Number(row.revenue),cost=Number(row.cost);
  if(!Number.isFinite(income)||!Number.isFinite(cost))throw Error('Invalid posted vehicle income/expense amount.');
  const key=date.slice(0,7);
  if(!byMonth.has(key))byMonth.set(key,{income:0,expenses:0,incomeEvents:0,expenseEvents:0,costs:new Map()});
  const m=byMonth.get(key)!;
  m.income+=income;m.expenses+=cost;
  if(income!==0)m.incomeEvents++;
  if(cost!==0){
   m.expenseEvents++;
   const account=String(row.expense_accounts||row.category||'Other expense');
   m.costs.set(account,(m.costs.get(account)||0)+cost);
  }
 }
 const money=(v:number)=>Math.round(v*100)/100;
 return [...byMonth].sort((a,b)=>b[0].localeCompare(a[0])).map(([month,m])=>({
  month,income:money(m.income),expenses:money(m.expenses),net:money(m.income-m.expenses),
  incomeEvents:m.incomeEvents,expenseEvents:m.expenseEvents,
  costDetails:[...m.costs].map(([account,amount])=>({account,amount:money(amount)})).sort((a,b)=>Math.abs(b.amount)-Math.abs(a.amount))
 }));
}
