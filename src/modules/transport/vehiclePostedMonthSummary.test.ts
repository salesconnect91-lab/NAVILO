import {describe,it,expect} from 'vitest';
import {groupPostedVehicleMonths} from './vehiclePostedMonthSummary';
describe('Vehicle posted month totals from existing canonical ledger rows',()=>{
 it('shows posted sales, expense details and net per calendar month without duplicate financials',()=>{
  const rows=groupPostedVehicleMonths([
   {event_date:'2026-09-01',revenue:27395,cost:0,category:'Sale Invoice'},
   {event_date:'2026-09-17',revenue:0,cost:600,category:'Posted Journal',expense_accounts:'General Expenses'},
   {event_date:'2026-09-17',revenue:0,cost:200,category:'Posted Journal',expense_accounts:'Driver Salary & Wages'},
   {event_date:'2026-09-19',revenue:0,cost:-100,category:'Reversal',expense_accounts:'General Expenses'},
   {event_date:'2026-10-01',revenue:2000,cost:0,category:'Sale Invoice'},
  ]);
  expect(rows[0]).toMatchObject({month:'2026-10',income:2000,expenses:0,net:2000,expenseEvents:0});
  expect(rows[1]).toMatchObject({month:'2026-09',income:27395,expenses:700,net:26695,incomeEvents:1,expenseEvents:3});
  expect(rows[1].costDetails).toEqual([{account:'General Expenses',amount:500},{account:'Driver Salary & Wages',amount:200}]);
 });
 it('does not interpret an Amjad credit liability as an expense when it is absent from canonical income/expense ledger',()=>{
  expect(groupPostedVehicleMonths([{event_date:'2026-09-05',revenue:0,cost:600}])[0].expenses).toBe(600);
  expect(groupPostedVehicleMonths([])).toEqual([]);
 });
 it('rejects incomplete or corrupt server amounts instead of falsely showing final net profit',()=>{
  expect(()=>groupPostedVehicleMonths([{event_date:'2026-09-05',revenue:'bad',cost:0}])).toThrow(/Invalid posted/);
  expect(()=>groupPostedVehicleMonths([{event_date:'bad',revenue:100,cost:0}])).toThrow(/date/);
 });
});
