import { supabase } from '@/lib/supabase';

export type QuickAddKind = 'truckType'|'customer'|'driver'|'supplier'|'vehicle'|'locationFrom'|'locationTo';
export const EMPTY_QUICK_MASTER = {name:'',mobile:'',email:'',address:'',truck_type_id:'',ownership_type:'company',
  supplier_id:'',effective_from:'',driver_type:'company',driver_code:'',identity_no:'',driving_licence_no:'',licence_expiry:''};
export type QuickMasterForm = typeof EMPTY_QUICK_MASTER;
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

// Reuse the canonical party creation (including AR/AP mapping) and Vehicle/history RPC.
// Other Transport masters use the same guarded tables as their dedicated Master forms.
export async function createQuickMaster(client:typeof supabase,kind:QuickAddKind,form:QuickMasterForm) {
  if(!form.name.trim())throw new Error('Name / vehicle number is required.');
  if((kind==='vehicle'&&form.ownership_type==='supplier'||kind==='driver'&&form.driver_type==='supplier')&&!form.supplier_id)
    throw new Error('Supplier is required for the selected type.');
  if(kind==='vehicle'&&!form.effective_from)throw new Error('Ownership Effective From is required.');
  let result:any;
  if(kind==='vehicle') {
    result=await client.rpc('transport_create_vehicle_master',{p_vehicle_no:form.name.trim(),p_truck_type_id:form.truck_type_id||null,
      p_owner_type:form.ownership_type,p_supplier_id:form.ownership_type==='supplier'?form.supplier_id:null,p_effective_from:form.effective_from});
  } else if(kind==='customer'||kind==='supplier') {
    result=await client.rpc(kind==='customer'?'create_customer_with_ar':'create_supplier_with_ap',
      {p_name:form.name.trim(),p_email:form.email.trim()||null,p_phone:form.mobile.trim()||null,p_address:form.address.trim()||null});
  } else {
    const table=kind==='driver'?'transport_drivers':kind==='truckType'?'transport_truck_types':'transport_locations';
    const fields=kind==='driver'?{driver_name:form.name.trim(),driver_code:form.driver_code.trim()||null,mobile:form.mobile.trim()||null,
      driver_type:form.driver_type,supplier_id:form.driver_type==='supplier'?form.supplier_id:null,identity_no:form.identity_no.trim()||null,
      driving_licence_no:form.driving_licence_no.trim()||null,licence_expiry:form.licence_expiry||null}:{name:form.name.trim()};
    result=await client.from(table).insert({...fields,is_active:true}).select('*').single();
  }
  if(result.error)throw result.error;
  const record=Array.isArray(result.data)?result.data[0]:result.data;
  const id=typeof record==='string'?record:record?.id;
  if(!id)throw new Error('Master creation returned no record. Refresh the master list before retrying.');
  return {id,name:form.name.trim(),truck_type_id:form.truck_type_id,...(typeof record==='object'?record:{})};
}

export function matchingCustomerRate(rates:any[],form:{customer_id:string;truck_type_id:string;from_location:string;to_location:string;trip_date:string},locations:any[]) {
  const from=locations.find(l=>masterKey(l.name)===masterKey(form.from_location));
  const to=locations.find(l=>masterKey(l.name)===masterKey(form.to_location));
  return rates.filter(r=>r.is_active!==false&&r.customer_id===form.customer_id&&r.truck_type_id===form.truck_type_id&&
    r.from_location_id===from?.id&&r.to_location_id===to?.id&&r.effective_from<=form.trip_date&&(!r.effective_to||r.effective_to>=form.trip_date))
    .sort((a,b)=>b.effective_from.localeCompare(a.effective_from)||a.id.localeCompare(b.id))[0]??null;
}
