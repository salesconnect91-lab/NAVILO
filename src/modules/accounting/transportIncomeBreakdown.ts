/** Posted general-ledger sales/service balances; presentation only, never a second posting. */
export type LedgerMovement={account_id:string|null;journal_entry_id?:string|null;debit:number|string|null;credit:number|string|null};
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

/** Service-classified income credited to a dedicated company vehicle account.
 * It remains part of the vehicle ledger and overall GL totals; this helper only
 * classifies the existing movement for the Transport P&L detail.
 */
export function dedicatedVehicleServiceIncomeTotal(
  vehicles:Array<{revenue_account_id:string|null}>,
  accounts:Array<{id:string;code:string|null;type:string|null;detail_type:string|null;is_group?:boolean|null;is_active?:boolean|null}>,
  entries:LedgerMovement[],
  excludedAccountIds:ReadonlySet<string>=new Set(),
  excludedIncomeByAccount:ReadonlyMap<string,number>=new Map(),
):number{
 const accountById=new Map(accounts.map(account=>[account.id,account]));
 const linkCounts=new Map<string,number>();
 for(const vehicle of vehicles)if(vehicle.revenue_account_id)
  linkCounts.set(vehicle.revenue_account_id,(linkCounts.get(vehicle.revenue_account_id)||0)+1);
 const eligible=new Set<string>();
 for(const vehicle of vehicles){
  const id=vehicle.revenue_account_id;
  if(!id||excludedAccountIds.has(id))continue;
  const account=accountById.get(id);
  if(!account||(account.type!=='revenue'&&account.type!=='income')||account.is_group===true||account.is_active===false)continue;
  const detail=(account.detail_type??'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  if(!['service_income','service_revenue','service'].includes(detail))continue;
  if((linkCounts.get(id)||0)>1||account.code==='4100'||account.code==='4200')continue;
  eligible.add(id);
 }
 let total=0;
 for(const row of entries)if(row.account_id&&eligible.has(row.account_id))
  total+=cents(Number(row.credit??0))-cents(Number(row.debit??0));
 for(const [accountId,excluded] of excludedIncomeByAccount)if(eligible.has(accountId))
  total-=cents(excluded);
 return amount(total);
}

/** Posted Sale Invoice attribution is normal Sales Income even when its vehicle GL has
 * the generic service_income detail type. Shared vehicle accounts stay in their mapped GL class.
 */
export function dedicatedVehicleNormalSalesIncomeBreakdown(
 vehicles:Array<{id:string;revenue_account_id:string|null}>,
 accounts:Array<{id:string;code:string|null;type:string|null;is_group?:boolean|null;is_active?:boolean|null}>,
 normalSalesRows:Array<{vehicle_id:string;amount:number|string}>,
):{total:number;byAccount:Map<string,number>}{
 const accountById=new Map(accounts.map(account=>[account.id,account]));
 const linkCounts=new Map<string,number>();
 for(const vehicle of vehicles)if(vehicle.revenue_account_id)
  linkCounts.set(vehicle.revenue_account_id,(linkCounts.get(vehicle.revenue_account_id)||0)+1);
 const accountForVehicle=new Map<string,string>();
 for(const vehicle of vehicles){
  const id=vehicle.revenue_account_id;
  if(!id)continue;
  const account=accountById.get(id);
  if(!account||(account.type!=='revenue'&&account.type!=='income')||account.is_group===true||account.is_active===false)continue;
  if((linkCounts.get(id)||0)>1||account.code==='4100'||account.code==='4200')continue;
  accountForVehicle.set(vehicle.id,id);
 }
 const centsByAccount=new Map<string,number>();
 for(const row of normalSalesRows){
  const accountId=accountForVehicle.get(row.vehicle_id);
  const value=Number(row.amount);
  if(!accountId||!Number.isFinite(value))continue;
  centsByAccount.set(accountId,(centsByAccount.get(accountId)||0)+cents(value));
 }
 const byAccount=new Map([...centsByAccount].map(([id,value])=>[id,amount(value)]));
 return {total:amount([...centsByAccount.values()].reduce((sum,value)=>sum+value,0)),byAccount};
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

/** Normal vehicle invoices posted to a dedicated vehicle COA already appear in
 * that account's net movement. Exclude their invoice snapshot from P&L detail
 * so one ledger is counted exactly once.
 */
export function excludeDedicatedVehicleAttributions<T extends {vehicle_id:string}>(
 rows:T[],dedicatedVehicleIds:ReadonlySet<string>,
):T[]{
 return rows.filter(row=>!dedicatedVehicleIds.has(row.vehicle_id));
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
