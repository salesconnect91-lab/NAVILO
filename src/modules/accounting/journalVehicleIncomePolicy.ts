/** Keep the GL account (what happened) and Vehicle dimension (to whom) consistent.
 * Revenue of a company-owned vehicle uses its existing dedicated income account.
 * Fuel/repair remain in their chosen expense GL and only carry vehicle identity.
 * This never creates a separate posting or changes amounts.
 */
export type VehicleIncomeLink={id:string;revenue_account_id:string|null};
export type RevenueGL={id:string;type:string};
export function isRevenueType(type:string|undefined):boolean{
 return type==='revenue'||type==='income';
}
export function journalVehicleAccountError(
 accountId:string,accountType:string|undefined,vehicleId:string,
 links:readonly VehicleIncomeLink[],
):string|null{
 const owner=links.find(v=>v.revenue_account_id===accountId);
 if(owner&&(!vehicleId||owner.id!==vehicleId))
  return 'This vehicle Income account belongs to a different company vehicle. Select its matching Vehicle in Related To.';
 if(!vehicleId||!isRevenueType(accountType))return null;
 const vehicle=links.find(v=>v.id===vehicleId);
 if(!vehicle)return 'Select a valid company-owned Vehicle.';
 if(!vehicle.revenue_account_id)return 'Vehicle has no linked Income account in Vehicle Master.';
 if(vehicle.revenue_account_id!==accountId)return 'The selected Vehicle has a different linked Income account. Use its own Income account.';
 return null;
}
export function accountForSelectedVehicle(
 currentAccountId:string,accountType:string|undefined,vehicleId:string,
 links:readonly VehicleIncomeLink[],accounts:readonly RevenueGL[],
):string{
 if(!vehicleId||!isRevenueType(accountType))return currentAccountId;
 const linked=links.find(v=>v.id===vehicleId)?.revenue_account_id;
 return linked&&accounts.some(a=>a.id===linked&&isRevenueType(a.type))
   ?linked:currentAccountId;
}
export function vehicleForIncomeAccount(
 accountId:string,links:readonly VehicleIncomeLink[],validVehicleIds:readonly string[],
):string{
 const match=links.find(v=>v.revenue_account_id===accountId&&validVehicleIds.includes(v.id));
 return match?.id??'';
}
