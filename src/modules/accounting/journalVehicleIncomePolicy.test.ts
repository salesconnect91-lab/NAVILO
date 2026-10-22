import {describe,expect,it} from 'vitest';
import {accountForSelectedVehicle,journalVehicleAccountError,vehicleForIncomeAccount,incomeVehicleAlreadyLinked,isDedicatedVehicleIncomeAccount,vehicleIncomeDebitError} from './journalVehicleIncomePolicy';
const links=[{id:'v7979',revenue_account_id:'income7979'},{id:'v7494',revenue_account_id:'income7494'},{id:'v5731',revenue_account_id:null}];
const accounts=[{id:'income7979',type:'revenue'},{id:'shared',type:'revenue'},{id:'fuel',type:'expense'}];
describe('Vehicle dimension preserves original General Ledger account',()=>{
 it('does not swap common Sales/Service Revenue or Expense GL',()=>{
  expect(accountForSelectedVehicle('shared','revenue','v7979',links,accounts)).toBe('shared');
  expect(accountForSelectedVehicle('shared','revenue','v5731',links,accounts)).toBe('shared');
  expect(accountForSelectedVehicle('fuel','expense','v7979',links,accounts)).toBe('fuel');
 });
 it('permits company-owned vehicles without a dedicated Income GL',()=>{
  expect(journalVehicleAccountError('shared','revenue','v7979',links)).toBe(null);
  expect(journalVehicleAccountError('shared','revenue','v5731',links)).toBe(null);
  expect(journalVehicleAccountError('shared','revenue','unknown',links)).toMatch(/valid company/i);
 });
 it('protects old dedicated Income accounts from cross-vehicle use',()=>{
  expect(journalVehicleAccountError('income7979','revenue','v7494',links)).toMatch(/different/i);
  expect(journalVehicleAccountError('income7979','revenue','v7979',links)).toBe(null);
  expect(journalVehicleAccountError('income7979','revenue','',links)).toMatch(/matching/i);
  expect(vehicleForIncomeAccount('income7979',links,['v7979'])).toBe('v7979');
  expect(incomeVehicleAlreadyLinked('income7979','revenue','v7979',links,['v7979'])).toBe(true);
  expect(isDedicatedVehicleIncomeAccount('income7979',links)).toBe(true);
 });
 it('leaves unallocated JE and non-income account unchanged',()=>{
  expect(journalVehicleAccountError('shared','revenue','',links)).toBe(null);
  expect(journalVehicleAccountError('fuel','expense','v7979',links)).toBe(null);
  expect(incomeVehicleAlreadyLinked('shared','revenue','v7979',links,['v7979'])).toBe(false);
  expect(isDedicatedVehicleIncomeAccount('shared',links)).toBe(false);
 });
 it('blocks expense debits to a linked Vehicle Income account while preserving revenue credits',()=>{
  expect(vehicleIncomeDebitError('income7979',510,links)).toMatch(/cannot be debited for expenses/i);
  expect(vehicleIncomeDebitError('income7979',0,links)).toBe(null);
  expect(vehicleIncomeDebitError('fuel',510,links)).toBe(null);
 });
});
