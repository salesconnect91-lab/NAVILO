import {describe,expect,it} from 'vitest';
import {compatibleVehicles,ownershipOnDate,matchingCustomerRate,estimatedMargin,validMoney} from './transportTripEntry';
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
