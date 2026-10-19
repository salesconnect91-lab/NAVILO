import {describe,it,expect} from 'vitest';
import {splitTransportRevenue,reconcileNormalVehicleIncome} from './transportIncomeBreakdown';
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
 it('keeps reversal differences in cents and zero balances displayable',()=>{
  const rows=reconcileNormalVehicleIncome(0,[
   {vehicle_id:'v1',vehicle_no:'1631',amount:-50.01},
   {vehicle_id:'v1',vehicle_no:'1631',amount:50.01},
  ],false);
  expect(rows).toEqual({vehicles:[{vehicle_id:'v1',vehicle_no:'1631',amount:0}],allocated:0,residual:0});
 });
});
