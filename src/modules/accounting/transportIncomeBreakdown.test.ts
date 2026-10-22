import {describe,it,expect} from 'vitest';
import {externalVehicleIncome,splitTransportRevenue,reconcileNormalVehicleIncome,mergeVehicleLedgerMovements,totalVehicleLedgerMovement} from './transportIncomeBreakdown';
describe('Transport company P&L - separate Sale and Trip Service income',()=>{
 it('reads posted accounting by different mapped revenue accounts, respecting contra debits',()=>{
  expect(splitTransportRevenue([
   {account_id:'sales',debit:0,credit:25000},
   {account_id:'sales',debit:500,credit:0},
   {account_id:'service',debit:100,credit:100000},
   {account_id:'other',debit:0,credit:1200},
  ],'sales','service')).toEqual({sales:24500,service:99900});
 });
 it('rejects same account mapping for sales and service to prevent mixing',()=>{
  expect(()=>splitTransportRevenue([],'same','same')).toThrow(/Distinct/);
 });
 it('matches each vehicle and does not double count normal Sale income',()=>{
  expect(reconcileNormalVehicleIncome(10000,[
    {vehicle_id:'v1',vehicle_no:'1631',amount:5000},
    {vehicle_id:'v2',vehicle_no:'2442',amount:3000},
    {vehicle_id:'v1',vehicle_no:'1631',amount:2000}
  ])).toEqual({vehicles:[
   {vehicle_id:'v1',vehicle_no:'1631',amount:7000},
   {vehicle_id:'v2',vehicle_no:'2442',amount:3000},
  ],allocated:10000,residual:0});
 });
 it('shows GL residual instead of creating an untagged No Vehicle invoice',()=>{
  const rows=reconcileNormalVehicleIncome(100,[
   {vehicle_id:'v1',vehicle_no:'1631',amount:110}
  ]);
  expect(rows.residual).toBe(-10);
  expect(rows.vehicles).toHaveLength(1);
 });
 it('allocates all posted Orbit external sales to four vehicles without adding GL revenue',()=>{
  const events=[
   {event_id:'journal1:line1',account_id:'v7979',account_name:'7979',revenue:'26295.00'},
   {event_id:'journal2:line2',account_id:'v2512',account_name:'2512',revenue:'20430.00'},
   {event_id:'journal3:line3',account_id:'v5731',account_name:'5731',revenue:'18730.00'},
   {event_id:'journal4:line4',account_id:'v7494',account_name:'7494',revenue:'18200.00'},
  ];
  const result=reconcileNormalVehicleIncome(83655,externalVehicleIncome(events));
  expect(result.vehicles).toEqual([
   {vehicle_id:'v2512',vehicle_no:'2512',amount:20430},
   {vehicle_id:'v5731',vehicle_no:'5731',amount:18730},
   {vehicle_id:'v7494',vehicle_no:'7494',amount:18200},
   {vehicle_id:'v7979',vehicle_no:'7979',amount:26295},
  ]);
  expect(result.allocated).toBe(83655);
  expect(result.residual).toBe(0);
 });
 it('preserves posting reversals and credit notes without double-counting repeated event ids',()=>{
  const posted=externalVehicleIncome([
   {event_id:'bill1',account_id:'v1',account_name:'7979',revenue:'1000.00'},
   {event_id:'bill1',account_id:'v1',account_name:'7979',revenue:'1000.00'},
   {event_id:'credit1',account_id:'v1',account_name:'7979',revenue:'-200.25'},
  ]);
  expect(reconcileNormalVehicleIncome(799.75,posted)).toEqual({
   vehicles:[{vehicle_id:'v1',vehicle_no:'7979',amount:799.75}],
   allocated:799.75,residual:0,
  });
 });
 it('rejects missing evidence rather than silently treating unallocated income as linked',()=>{
  expect(()=>externalVehicleIncome([{event_id:'event',account_id:'',account_name:'7979',revenue:'100'}])).toThrow(/Incomplete/);
  expect(()=>externalVehicleIncome([
   {event_id:'dup',account_id:'v1',account_name:'7979',revenue:'100'},
   {event_id:'dup',account_id:'v2',account_name:'2512',revenue:'100'}
  ])).toThrow(/Conflicting/);
 });
 it('keeps reversal differences in cents and zero balances displayable',()=>{
  const rows=reconcileNormalVehicleIncome(0,[
   {vehicle_id:'v1',vehicle_no:'1631',amount:-50.01},
   {vehicle_id:'v1',vehicle_no:'1631',amount:50.01},
  ],false);
  expect(rows).toEqual({vehicles:[{vehicle_id:'v1',vehicle_no:'1631',amount:0}],allocated:0,residual:0});
 });
 it('keeps invoice income and vehicle-account debits together on one vehicle row',()=>{
  const linked=[
   {vehicle_id:'v7979',vehicle_no:'7979',amount:-2283.21,status:'dedicated' as const},
   {vehicle_id:'v7494',vehicle_no:'7494',amount:-849.16,status:'dedicated' as const},
   {vehicle_id:'v5731',vehicle_no:'5731',amount:-1783.21,status:'dedicated' as const},
   {vehicle_id:'v2512',vehicle_no:'2512',amount:-1843.09,status:'dedicated' as const},
   {vehicle_id:'shared',vehicle_no:'9999',amount:-100,status:'shared' as const},
  ];
  const net=mergeVehicleLedgerMovements([
   {vehicle_id:'v7979',vehicle_no:'7979',amount:27395},
   {vehicle_id:'v7494',vehicle_no:'7494',amount:29530},
   {vehicle_id:'v5731',vehicle_no:'5731',amount:18200},
   {vehicle_id:'v2512',vehicle_no:'2512',amount:26730},
  ],linked);
  expect(net).toEqual([
   {vehicle_id:'v2512',vehicle_no:'2512',invoiceAmount:26730,ledgerAmount:-1843.09,amount:24886.91},
   {vehicle_id:'v5731',vehicle_no:'5731',invoiceAmount:18200,ledgerAmount:-1783.21,amount:16416.79},
   {vehicle_id:'v7494',vehicle_no:'7494',invoiceAmount:29530,ledgerAmount:-849.16,amount:28680.84},
   {vehicle_id:'v7979',vehicle_no:'7979',invoiceAmount:27395,ledgerAmount:-2283.21,amount:25111.79},
  ]);
  expect(totalVehicleLedgerMovement(linked)).toBe(-6758.67);
  expect(net.reduce((sum,row)=>sum+row.amount,0)).toBeCloseTo(95096.33,2);
 });
});
