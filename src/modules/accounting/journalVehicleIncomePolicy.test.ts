import {describe,expect,it} from 'vitest';
import {accountForSelectedVehicle,journalVehicleAccountError,vehicleForIncomeAccount} from './journalVehicleIncomePolicy';
const links=[{id:'v7979',revenue_account_id:'income7979'},{id:'v7494',revenue_account_id:'income7494'},{id:'v5731',revenue_account_id:null}];
const accounts=[{id:'income7979',type:'revenue'},{id:'income7494',type:'revenue'},{id:'shared',type:'revenue'},{id:'fuel',type:'expense'}];
describe('QuickBooks-style vehicle accounting (one GL entry, optional dimension)',()=>{
 it('switches only revenue to the selected company vehicle income GL',()=>{
  expect(accountForSelectedVehicle('shared','revenue','v7979',links,accounts)).toBe('income7979');
  expect(accountForSelectedVehicle('fuel','expense','v7979',links,accounts)).toBe('fuel');
  expect(accountForSelectedVehicle('shared','revenue','v5731',links,accounts)).toBe('shared');
 });
 it('finds matching owned vehicle automatically from dedicated income GL',()=>{
  expect(vehicleForIncomeAccount('income7494',links,['v7979','v7494'])).toBe('v7494');
  expect(vehicleForIncomeAccount('income7494',links,['v7979'])).toBe('');
 });
 it('rejects income/vehicle cross-allocation and unlinked vehicles',()=>{
  expect(journalVehicleAccountError('income7979','revenue','v7494',links)).toMatch(/different/i);
  expect(journalVehicleAccountError('shared','revenue','v7979',links)).toMatch(/different/i);
  expect(journalVehicleAccountError('shared','revenue','v5731',links)).toMatch(/no linked/i);
  expect(journalVehicleAccountError('income7979','revenue','',links)).toMatch(/matching/i);
 });
 it('keeps actual expense GL and does not automatically post or allocate unrelated rows',()=>{
  expect(journalVehicleAccountError('fuel','expense','v7979',links)).toBe(null);
  expect(journalVehicleAccountError('fuel','expense','',links)).toBe(null);
  expect(journalVehicleAccountError('shared','revenue','',links)).toBe(null);
 });
});
