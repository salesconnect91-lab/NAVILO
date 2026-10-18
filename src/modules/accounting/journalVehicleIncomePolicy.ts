/** Vehicle is an accounting dimension and never replaces the original GL. */
export type VehicleIncomeLink={id:string;revenue_account_id:string|null};
export type RevenueGL={id:string;type:string};
export function isRevenueType(type:string|undefined):boolean{return type==='revenue'||type==='income';}
export function journalVehicleAccountError(accountId:string,accountType:string|undefined,vehicleId:string,links:readonly VehicleIncomeLink[]):string|null{
 const mapped=links.filter(v=>v.revenue_account_id===accountId);
 if(mapped.length&&(!vehicleId||!mapped.some(v=>v.id===vehicleId)))return 'This vehicle Income account belongs to a different company vehicle. Select its matching Vehicle in Related To.';
 if(!vehicleId||!isRevenueType(accountType))return null;
 if(!links.some(v=>v.id===vehicleId))return 'Select a valid company-owned Vehicle.';
 return null;
}
export function accountForSelectedVehicle(currentAccountId:string,_accountType:string|undefined,_vehicleId:string,_links:readonly VehicleIncomeLink[],_accounts:readonly RevenueGL[]):string{return currentAccountId;}
export function vehicleForIncomeAccount(accountId:string,links:readonly VehicleIncomeLink[],validVehicleIds:readonly string[]):string{
 const matches=links.filter(v=>v.revenue_account_id===accountId&&validVehicleIds.includes(v.id));
 return matches.length===1?matches[0].id:'';
}
export function incomeVehicleAlreadyLinked(accountId:string,accountType:string|undefined,vehicleId:string,links:readonly VehicleIncomeLink[],eligibleVehicleIds:readonly string[]):boolean{
 if(!isRevenueType(accountType)||!accountId||!vehicleId)return false;
 const matches=links.filter(v=>v.revenue_account_id===accountId);
 return matches.length===1&&matches[0].id===vehicleId&&eligibleVehicleIds.includes(vehicleId);
}
