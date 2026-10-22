/** Posted general-ledger sales/service balances; presentation only, never a second posting. */
export type LedgerMovement={account_id:string|null;debit:number|string|null;credit:number|string|null};
export type VehicleIncome={vehicle_id:string;vehicle_no:string;amount:number;invoiceAmount?:number;ledgerAmount?:number};
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

/** Combine invoice attribution with the linked vehicle GL's signed movement.
 * A dedicated vehicle account is the single ledger for that vehicle: credits
 * add income and debits reduce its net contribution. Shared Sales/Service GLs
 * are deliberately excluded because they cannot be assigned to one vehicle.
 */
export function mergeVehicleLedgerMovements(
 attributed:VehicleIncome[],
 linkedAccounts:Array<{vehicle_id:string;vehicle_no:string;amount:number|null;status:'dedicated'|'shared'|'missing'}>,
 hideZero=true,
):VehicleIncome[]{
 const rows=new Map<string,VehicleIncome>();
 for(const row of attributed){
  const current=rows.get(row.vehicle_id);
  const invoiceAmount=cents(current?.invoiceAmount??current?.amount??0)+cents(row.amount);
  rows.set(row.vehicle_id,{vehicle_id:row.vehicle_id,vehicle_no:row.vehicle_no,
   invoiceAmount:amount(invoiceAmount),ledgerAmount:current?.ledgerAmount??0,
   amount:amount(invoiceAmount+cents(current?.ledgerAmount??0))});
 }
 for(const link of linkedAccounts){
  if(link.status!=='dedicated'||link.amount===null||!Number.isFinite(link.amount))continue;
  const current=rows.get(link.vehicle_id);
  const invoiceAmount=cents(current?.invoiceAmount??current?.amount??0);
  const ledgerAmount=cents(current?.ledgerAmount??0)+cents(link.amount);
  rows.set(link.vehicle_id,{vehicle_id:link.vehicle_id,vehicle_no:link.vehicle_no,
   invoiceAmount:amount(invoiceAmount),ledgerAmount:amount(ledgerAmount),amount:amount(invoiceAmount+ledgerAmount)});
 }
 return [...rows.values()].filter(row=>!hideZero||Math.abs(row.amount)>=0.005)
  .sort((a,b)=>a.vehicle_no.localeCompare(b.vehicle_no,undefined,{numeric:true}));
}

export function totalVehicleLedgerMovement(
 rows:Array<{vehicle_id:string;vehicle_no:string;amount:number|null;status:'dedicated'|'shared'|'missing'}>,
):number{
 return amount(rows.filter(row=>row.status==='dedicated'&&row.amount!==null)
  .reduce((total,row)=>total+cents(row.amount!),0));
}


export type ExternalVehicleLedgerRow={
 event_id:string;account_id:string|null;account_name:string|null;revenue:number|string|null;
};

/** Only posted, journal-backed external invoice revenue is passed here. It is
 * an attribution of existing Sales Revenue, never an extra GL movement.
 * Keep reversals / credit notes as signed contributions.
 */
export function externalVehicleIncome(rows:ExternalVehicleLedgerRow[]):VehicleIncome[]{
 const byEvent=new Map<string,ExternalVehicleLedgerRow>();
 for(const row of rows){
  if(!row.event_id||!row.account_id||!row.account_name?.trim()||
     row.revenue===null||row.revenue===undefined||!Number.isFinite(Number(row.revenue)))
   throw new Error('Incomplete posted external vehicle income evidence');
  if(byEvent.has(row.event_id)){
   const prior=byEvent.get(row.event_id)!;
   if(prior.account_id!==row.account_id||prior.account_name!==row.account_name||
       cents(Number(prior.revenue))!==cents(Number(row.revenue)))
    throw new Error('Conflicting external vehicle journal events');
   continue;
  }
  byEvent.set(row.event_id,row);
 }
 const totals=new Map<string,VehicleIncome>();
 for(const row of byEvent.values()){
  const id=row.account_id!;
  const prior=totals.get(id);
  if(prior&&prior.vehicle_no!==row.account_name)
   throw new Error('Conflicting vehicle labels for posted journal entries');
  totals.set(id,{vehicle_id:id,vehicle_no:row.account_name!,
   amount:amount(cents(prior?.amount??0)+cents(Number(row.revenue)))});
 }
 return [...totals.values()];
}
