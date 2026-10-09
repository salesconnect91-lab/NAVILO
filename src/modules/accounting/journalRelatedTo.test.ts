import {describe,it,expect} from 'vitest';
import {journalRelatedToMode,vehicleOwnedOnDate,normalizedJournalVehicleNo} from './journalRelatedTo';
describe('Fast Journal smart Related To selection',()=>{
 it('selects customer/supplier identity before other modes',()=>{
  expect(journalRelatedToMode('liability',true,true)).toBe('party');
  expect(journalRelatedToMode('asset',true,true)).toBe('party');
 });
 it('shows vehicle only for transport income and expense accounts',()=>{
  expect(journalRelatedToMode('expense',false,true)).toBe('vehicle');
  expect(journalRelatedToMode('revenue',false,true)).toBe('vehicle');
  expect(journalRelatedToMode('income',false,true)).toBe('vehicle');
  expect(journalRelatedToMode('expense',false,false)).toBe('general');
  expect(journalRelatedToMode('liability',false,true)).toBe('general');
 });
 it('limits selectable company vehicles by journal date and ownership history',()=>{
  const periods=[{vehicle_id:'x',owner_type:'company',effective_from:'2026-08-01',effective_to:'2026-09-30'},
    {vehicle_id:'x',owner_type:'supplier',effective_from:'2026-10-01',effective_to:null}];
  expect(vehicleOwnedOnDate('x','2026-08-31',periods)).toBe(true);
  expect(vehicleOwnedOnDate('x','2026-09-30',periods)).toBe(true);
  expect(vehicleOwnedOnDate('x','2026-10-01',periods)).toBe(false);
  expect(vehicleOwnedOnDate('x',undefined,periods)).toBe(false);
 });
 it('accepts printed plate plus truck type without inventing vehicle identity',()=>{
  expect(normalizedJournalVehicleNo('7979 · Dyna')).toBe('7979');
  expect(normalizedJournalVehicleNo(' 2512 ')).toBe('2512');
 });
});
