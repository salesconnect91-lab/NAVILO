import {describe,expect,it,vi} from 'vitest';
import {createQuickMaster,EMPTY_QUICK_MASTER,compatibleVehicles,ownershipOnDate,matchingCustomerRate,estimatedMargin,validMoney,type QuickAddKind} from './transportTripEntry';
vi.mock('@/lib/supabase',()=>({supabase:{}}));
function client() {
 const insert=vi.fn();const rpc=vi.fn(async(name:string)=>({data:name==='transport_create_vehicle_master'?'new':{id:'new'},error:null}));
 const from=vi.fn((table:string)=>({insert:(values:any)=>{insert(table,values);return {select:()=>({single:async()=>({data:{id:'new'},error:null})})}}}));
 return {insert,rpc,from};
}
describe('Canonical quick masters',()=>{
 it.each(['truckType','locationFrom','locationTo'] as QuickAddKind[])('creates active scoped %s using guarded master table',async kind=>{
  const c=client();const result=await createQuickMaster(c as any,kind,{...EMPTY_QUICK_MASTER,name:' New '});
  expect(result.id).toBe('new');expect(c.insert).toHaveBeenCalledWith(kind==='truckType'?'transport_truck_types':'transport_locations',{name:'New',is_active:true});
 });
 it.each(['customer','supplier'] as QuickAddKind[])('reuses canonical %s AR/AP RPC',async kind=>{
  const c=client();await createQuickMaster(c as any,kind,{...EMPTY_QUICK_MASTER,name:'Party',mobile:'123'});
  expect(c.rpc).toHaveBeenCalledWith(kind==='customer'?'create_customer_with_ar':'create_supplier_with_ap',{p_name:'Party',p_phone:'123',p_email:null,p_address:null});expect(c.insert).not.toHaveBeenCalled();
 });
 it.each(['company','supplier'])('creates structured %s Driver independently from Vehicle',async driver_type=>{
  const c=client();await createQuickMaster(c as any,'driver',{...EMPTY_QUICK_MASTER,name:'Driver',driver_type,supplier_id:'s',driver_code:'D-1',mobile:'200',identity_no:'ID',driving_licence_no:'LIC',licence_expiry:'2027-01-01'});
  expect(c.insert).toHaveBeenCalledWith('transport_drivers',expect.objectContaining({driver_type,supplier_id:driver_type==='supplier'?'s':null,driver_code:'D-1',identity_no:'ID',driving_licence_no:'LIC',licence_expiry:'2027-01-01'}));
  expect(c.insert.mock.calls[0][1]).not.toHaveProperty('vehicle_id');
 });
 it.each(['company','supplier'])('creates %s Vehicle atomically with initial ownership',async ownership_type=>{
  const c=client();await createQuickMaster(c as any,'vehicle',{...EMPTY_QUICK_MASTER,name:'Plate',ownership_type,supplier_id:'s',truck_type_id:'tt',effective_from:'2026-01-01'});
  expect(c.rpc).toHaveBeenCalledWith('transport_create_vehicle_master',{p_vehicle_no:'Plate',p_owner_type:ownership_type,p_supplier_id:ownership_type==='supplier'?'s':null,p_truck_type_id:'tt',p_effective_from:'2026-01-01'});expect(c.insert).not.toHaveBeenCalled();
 });
 it('requires Supplier for Supplier Driver/Vehicle and actual date for Vehicle',async()=>{
  const c=client();await expect(createQuickMaster(c as any,'driver',{...EMPTY_QUICK_MASTER,name:'D',driver_type:'supplier'})).rejects.toThrow('Supplier is required');
  await expect(createQuickMaster(c as any,'vehicle',{...EMPTY_QUICK_MASTER,name:'V'})).rejects.toThrow('Effective From');expect(c.rpc).not.toHaveBeenCalled();
 });
 it.each(['Duplicate master','Transport master permission required','Company / BU mismatch'])('surfaces server rejection: %s',async message=>{
  const c=client();c.rpc.mockResolvedValue({data:null,error:{message}} as any);
  await expect(createQuickMaster(c as any,'vehicle',{...EMPTY_QUICK_MASTER,name:'V',effective_from:'2026-01-01'})).rejects.toMatchObject({message});
 });
});
describe('Trip date and operational estimates',()=>{
 const history=[{id:'old',vehicle_id:'v',owner_type:'third_party',supplier_id:'s',owner_name_snapshot:'Supplier',effective_from:'2026-01-01',effective_to:'2026-06-30'},
  {id:'new',vehicle_id:'v',owner_type:'company',supplier_id:null,owner_name_snapshot:'Company',effective_from:'2026-07-01',effective_to:null}];
 it('resolves backdated Supplier and current Company owner without legacy fallback',()=>{
  expect(ownershipOnDate(history,'v','2026-06-30')?.supplier_id).toBe('s');expect(ownershipOnDate(history,'v','2026-07-01')?.owner_type).toBe('company');expect(ownershipOnDate(history,'v','2025-12-31')).toBeNull();
 });
 it('filters active Vehicles with exact selected Truck Type',()=>{expect(compatibleVehicles([{is_active:true,truck_type_id:'tt'},{is_active:true,truck_type_id:null},{is_active:false,truck_type_id:'tt'}],'tt')).toEqual([{is_active:true,truck_type_id:'tt'}]);});
 it('matches rate by Customer, route, Truck Type and effective Trip Date',()=>{
  const rate={id:'r',customer_id:'c',truck_type_id:'tt',from_location_id:'f',to_location_id:'t',effective_from:'2026-01-01',effective_to:'2026-06-30',amount:100};
  const form={customer_id:'c',truck_type_id:'tt',from_location:'From',to_location:'To',trip_date:'2026-05-01'};
  expect(matchingCustomerRate([rate],form,[{id:'f',name:'From'},{id:'t',name:'To'}])).toEqual(rate);
  expect(matchingCustomerRate([rate],{...form,trip_date:'2026-07-01'},[{id:'f',name:'From'},{id:'t',name:'To'}])).toBeNull();
 });
 it('keeps Supplier Rent and Driver Pay distinct; estimate excludes later expenses',()=>{
  expect(estimatedMargin('1000','300','50',true)).toBe('650.00');expect(estimatedMargin('1000','','50',false)).toBe('950.00');expect(estimatedMargin('1000','','50',true)).toBe('');
 });
 it('rejects negative, nonfinite and fractional-cent amounts',()=>{for(const x of ['-1','NaN','Infinity','1.001'])expect(validMoney(x)).toBe(false);expect(validMoney('0')).toBe(true);expect(validMoney('')).toBe(true);});
});
