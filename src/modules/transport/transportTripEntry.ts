export type QuickAddKind = 'truckType'|'customer'|'driver'|'supplier'|'vehicle'|'locationFrom'|'locationTo';
export const masterKey = (value:unknown) => String(value??'').trim().replace(/\s+/g,' ').toLocaleLowerCase();
export type OwnershipPeriod = {id:string;vehicle_id:string;owner_type:string;supplier_id:string|null;owner_name_snapshot:string|null;effective_from:string;effective_to:string|null};
export function ownershipOnDate(history:OwnershipPeriod[], vehicleId:string, date:string) {
  return history.find(p=>p.vehicle_id===vehicleId&&p.effective_from<=date&&(!p.effective_to||p.effective_to>=date))??null;
}
export function compatibleVehicles<T extends {is_active?:boolean;truck_type_id?:string|null}>(vehicles:T[],truckTypeId:string) {
  return vehicles.filter(v=>v.is_active!==false&&(!truckTypeId||v.truck_type_id===truckTypeId));
}
export function estimatedMargin(rate:string,rent:string,pay:string,supplierOwned:boolean) {
  if(rate===''||(supplierOwned&&rent===''))return '';
  return (Number(rate)-Number(supplierOwned?rent:0)-Number(pay||0)).toFixed(2);
}
export function validMoney(value:string) {return value===''||(/^\d+(\.\d{1,2})?$/.test(value)&&Number.isFinite(Number(value)));}

export function matchingCustomerRate(rates:any[],form:{customer_id:string;truck_type_id:string;from_location:string;to_location:string;trip_date:string},locations:any[]) {
  const from=locations.find(l=>masterKey(l.name)===masterKey(form.from_location));
  const to=locations.find(l=>masterKey(l.name)===masterKey(form.to_location));
  return rates.filter(r=>r.is_active!==false&&r.customer_id===form.customer_id&&r.truck_type_id===form.truck_type_id&&
    r.from_location_id===from?.id&&r.to_location_id===to?.id&&r.effective_from<=form.trip_date&&(!r.effective_to||r.effective_to>=form.trip_date))
    .sort((a,b)=>b.effective_from.localeCompare(a.effective_from)||a.id.localeCompare(b.id))[0]??null;
}
