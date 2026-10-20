import {describe,it,expect} from 'vitest';
import {validateTransportMasterRows,validateTransportRateRows,mapImportPreviewLimited} from './importCenterValidation';
describe('Import Center validation before any RPC write',()=>{
 it('rejects invalid rates, missing names and Excel NaN values',()=>{
  expect(()=>validateTransportRateRows('customer',[{company:'Acme',truck_type:'Flatbed',from:'Dammam',to:'Riyadh',amount:NaN,effective_from:'2026-10-20',effective_to:'2026-12-31'}])).toThrow(/Row 2: Rate must/);
  expect(()=>validateTransportRateRows('supplier',[{supplier:'',truck_type:'Flatbed',from:'Dammam',to:'Riyadh',amount:500,effective_from:'2026-10-20'}])).toThrow(/Supplier is required/);
  expect(()=>validateTransportRateRows('customer_charge',[{company:'Acme',charge_code:'W',status:'agreed',amount:NaN,effective_from:'2026-10-20'}])).toThrow(/Agreed charge Amount/);
  expect(()=>validateTransportRateRows('customer',[{company:'Acme',truck_type:'Flatbed',from:'A',to:'B',amount:500,effective_from:'2026-02-31'}])).toThrow(/Effective From/);
  expect(()=>validateTransportRateRows('supplier',[{supplier:'S',truck_type:'Flatbed',from:'A',to:'B',amount:450,effective_from:'2026-10-20',effective_to:'2026-10-01'}])).toThrow(/Effective To cannot precede/);
 });
 it('rejects incorrectly mapped Transport masters, preserves valid ownership history',()=>{
  expect(()=>validateTransportMasterRows('vehicles',[{vehicle_no:'123',owner_type:'supplier',supplier:'',truck_type:'Flatbed',effective_from:'2026-10-20'}])).toThrow(/Supplier name/);
  expect(()=>validateTransportMasterRows('drivers',[{driver_name:'A',driver_type:'supplier',supplier:''}])).toThrow(/Supplier is required/);
  expect(()=>validateTransportMasterRows('drivers',[{driver_name:'A',driver_type:'company',supplier:'S'}])).toThrow(/linked to an Employee/);
  expect(()=>validateTransportMasterRows('truck_types',[{name:'Flatbed'},{name:'flatbed'}])).toThrow(/Duplicate/);
  expect(()=>validateTransportMasterRows('vehicle_ownership',[{vehicle_no:'123',owner_type:'supplier',supplier:'S',effective_from:'2026-10-20',effective_to:'2026-11-01'},{vehicle_no:'123',owner_type:'company',effective_from:'2026-11-02'}])).not.toThrow();
 });
 it('bounds concurrent transfer lookups without reordering row results',async()=>{
  let active=0,max=0;
  const rows=Array.from({length:31},(_,i)=>i);
  const result=await mapImportPreviewLimited(rows,async(n)=>{
   active++;max=Math.max(max,active);
   await Promise.resolve();await Promise.resolve();
   active--;return n*3;
  },4);
  expect(result).toEqual(rows.map(n=>n*3));expect(max).toBeLessThanOrEqual(4);expect(max).toBeGreaterThan(1);
 });
});
