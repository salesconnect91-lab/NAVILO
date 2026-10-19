/** Posted general-ledger sales/service balances; presentation only, never a second posting. */
export type LedgerMovement={account_id:string|null;debit:number|string|null;credit:number|string|null};
export type VehicleIncome={vehicle_id:string;vehicle_no:string;amount:number};
const cents=(value:number)=>Math.round(value*100);
const amount=(n:number)=>Number((n/100).toFixed(2));

export function splitTransportRevenue(
  entries:LedgerMovement[],salesAccountId:string,serviceAccountId:string,
){
 if(!salesAccountId||!serviceAccountId||salesAccountId===serviceAccountId)
   throw new Error('Distinct Sales Revenue and Service Revenue mappings are required.');
 let sales=0,service=0;
 for(const row of entries){
  const delta=cents(Number(row.credit??0))-cents(Number(row.debit??0));
  if(row.account_id===salesAccountId)sales+=delta;
  else if(row.account_id===serviceAccountId)service+=delta;
 }
 return {sales:amount(sales),service:amount(service)};
}

/** Per-vehicle values are an attribution OF Sales Revenue, not additional revenue.
 * A residual represents GL adjustments or old entries without allocation evidence.
 * Never fabricate a "No Vehicle" invoice or silently absorb discrepancies.
 */
export function reconcileNormalVehicleIncome(
  totalSales:number,rows:VehicleIncome[],hideZero=true,
){
 const totals=new Map<string,VehicleIncome>();
 for(const row of rows){
  if(!row.vehicle_id||!row.vehicle_no||!Number.isFinite(row.amount))
    throw new Error('Invalid vehicle income attribution returned by accounting.');
  const old=totals.get(row.vehicle_id);
  totals.set(row.vehicle_id,{vehicle_id:row.vehicle_id,vehicle_no:row.vehicle_no,amount:amount(cents(old?.amount??0)+cents(row.amount))});
 }
 const vehicles=[...totals.values()].filter(x=>!hideZero||Math.abs(x.amount)>0.004).sort((a,b)=>a.vehicle_no.localeCompare(b.vehicle_no,undefined,{numeric:true}));
 const allocated=amount([...totals.values()].reduce((v,r)=>v+cents(r.amount),0));
 return {vehicles,allocated,residual:amount(cents(totalSales)-cents(allocated))};
}
