// Read-only General P&L breakdown. Amounts are ALREADY in Operating Revenue.
// Only a dedicated COA can be attributed to one vehicle without double-counting.
export type CompanyVehicle={id:string;vehicle_no:string;revenue_account_id:string|null};
export type VehicleIncomeRow={id:string;vehicle_no:string;accountCode:string|null;amount:number|null;status:'dedicated'|'shared'|'missing'};
export type IncomeAccount={id:string;code:string|null;type:string|null;is_group:boolean|null;is_active:boolean|null};
export type IncomeMovement={account_id:string|null;debit:number|string|null;credit:number|string|null};

export function companyVehicleIncomeRows(
 vehicles:CompanyVehicle[], accounts:IncomeAccount[], ledgerLines:IncomeMovement[],
):VehicleIncomeRow[]{
 const accountById=new Map(accounts.map(a=>[a.id,a]));
 const linkCounts=new Map<string,number>();
 for(const v of vehicles)if(v.revenue_account_id)linkCounts.set(v.revenue_account_id,(linkCounts.get(v.revenue_account_id)||0)+1);
 const movements=new Map<string,number>();
 for(const line of ledgerLines){
  if(!line.account_id)continue;
  const a=accountById.get(line.account_id);
  if(!a||a.type!=='revenue'&&a.type!=='income')continue;
  movements.set(line.account_id,(movements.get(line.account_id)||0)+Number(line.credit??0)-Number(line.debit??0));
 }
 return vehicles.map(v=>{
  const a=v.revenue_account_id?accountById.get(v.revenue_account_id):undefined;
  const shared=!!v.revenue_account_id&&(linkCounts.get(v.revenue_account_id)!>1||a?.code==='4100'||a?.code==='4200');
  const dedicated=!!a&&!shared&&(a.type==='revenue'||a.type==='income')&&a.is_group===false&&a.is_active!==false;
  return {id:v.id,vehicle_no:v.vehicle_no,accountCode:a?.code??null,amount:dedicated?movements.get(v.revenue_account_id!)??0:null,
   status:dedicated?'dedicated':shared?'shared':'missing'};
 });
}
