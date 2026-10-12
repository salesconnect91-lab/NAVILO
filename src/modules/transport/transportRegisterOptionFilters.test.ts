import {describe,expect,it} from 'vitest';
import {registerOptionFilters} from './transportRegisterOptionFilters';

describe('register option cascading',()=>{
  const filters={fromDate:'2026-10-01',toDate:'',search:'',columns:{driver:['Adam'],plate:['5731'],from:[],company:['Twakkal']}};
  it('keeps the other column selections and removes only the current column',()=>{
    const input=registerOptionFilters(filters,'driver');
    expect(input.columns).toEqual({plate:['5731'],company:['Twakkal']});
    expect(input.fromDate).toBe('2026-10-01');
    expect(filters.columns.driver).toEqual(['Adam']);
  });
  it('does not change available option context when the same column checkbox toggles',()=>{
    const before=registerOptionFilters(filters,'driver');
    const after=registerOptionFilters({...filters,columns:{...filters.columns,driver:['Adam','Bob']}},'driver');
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
  it('does change option context when a different column is selected',()=>{
    const before=registerOptionFilters(filters,'driver');
    const after=registerOptionFilters({...filters,columns:{...filters.columns,plate:['ABC']}},'driver');
    expect(JSON.stringify(after)).not.toBe(JSON.stringify(before));
  });
});
