import {describe,it,expect} from 'vitest';
import {TRANSPORT_REASON_OPTIONS,reasonPresetValue} from './transportRateReasons';
describe('Transport register reason choices',()=>{
 it('provides choices in each financial and operational popup',()=>{
  for(const options of Object.values(TRANSPORT_REASON_OPTIONS)){
   expect(options.length).toBeGreaterThanOrEqual(4);
   expect(new Set(options).size).toBe(options.length);
  }
 });
 it('does not invent a reason for Other and supports custom audits',()=>{
  expect(reasonPresetValue('trip_edit','')).toBe('');
  expect(reasonPresetValue('trip_delete','Duplicate Trip entry')).toBe('Duplicate Trip entry');
  expect(reasonPresetValue('finance','Client-specific reason')).toBe('__other__');
  expect(reasonPresetValue('supplier_rate','',true)).toBe('__other__');
 });
});
