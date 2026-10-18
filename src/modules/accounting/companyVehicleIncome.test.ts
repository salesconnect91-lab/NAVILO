import {describe,it,expect} from 'vitest';
import {companyVehicleIncomeRows} from './companyVehicleIncome';

const vehicles=[
 {id:'v7979',vehicle_no:'7979',revenue_account_id:'account-7979'},
 {id:'v7494',vehicle_no:'7494',revenue_account_id:'account-7494'},
 {id:'v5731',vehicle_no:'5731',revenue_account_id:'service'},
 {id:'v2512',vehicle_no:'2512',revenue_account_id:'service'},
];
const accounts=[
 {id:'account-7979',code:'4001',type:'revenue',is_group:false,is_active:true},
 {id:'account-7494',code:'4002',type:'revenue',is_group:false,is_active:true},
 {id:'service',code:'4200',type:'revenue',is_group:false,is_active:true},
];
describe('P&L company-owned vehicle breakdown',()=>{
 it('always shows every company vehicle, even with zero income',()=>{
  const rows=companyVehicleIncomeRows(vehicles,accounts,[]);
  expect(rows.map(r=>r.vehicle_no)).toEqual(['7979','7494','5731','2512']);
  expect(rows.slice(0,2).map(r=>r.amount)).toEqual([0,0]);
  expect(rows.slice(2).map(r=>r.status)).toEqual(['shared','shared']);
  expect(rows.slice(2).map(r=>r.amount)).toEqual([null,null]);
 });
 it('shows posted revenue only in dedicated vehicle accounts without duplicating shared Service Revenue',()=>{
  const rows=companyVehicleIncomeRows(vehicles,accounts,[
   {account_id:'account-7979',credit:5000,debit:500},
   {account_id:'account-7494',credit:2200,debit:0},
   {account_id:'service',credit:10000,debit:0},
  ]);
  expect(rows[0]).toMatchObject({accountCode:'4001',amount:4500,status:'dedicated'});
  expect(rows[1]).toMatchObject({accountCode:'4002',amount:2200,status:'dedicated'});
  expect(rows.slice(2).every(row=>row.amount===null)).toBe(true);
 });
 it('never allocates shared, inactive, or non-revenue accounts to one vehicle',()=>{
  const rows=companyVehicleIncomeRows([
   {id:'a',vehicle_no:'1',revenue_account_id:'same'},
   {id:'b',vehicle_no:'2',revenue_account_id:'same'},
   {id:'c',vehicle_no:'3',revenue_account_id:'expense'},
   {id:'d',vehicle_no:'4',revenue_account_id:null},
  ],[
   {id:'same',code:'4007',type:'revenue',is_group:false,is_active:true},
   {id:'expense',code:'6100',type:'expense',is_group:false,is_active:true},
  ],[{account_id:'same',credit:300,debit:0}]);
  expect(rows.map(r=>r.status)).toEqual(['shared','shared','missing','missing']);
  expect(rows.every(r=>r.amount===null)).toBe(true);
 });
});
