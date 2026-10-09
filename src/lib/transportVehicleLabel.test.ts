import {describe,it,expect} from 'vitest';
import {vehicleDisplayLabel} from './transportVehicleLabel';
describe('vehicle display labels',()=>{
  it('shows plate and type together',()=>{
    expect(vehicleDisplayLabel('7979','Dyna')).toBe('7979 · Dyna');
    expect(vehicleDisplayLabel('7494','Trailer')).toBe('7494 · Trailer');
  });
  it('preserves raw identity when type is unavailable',()=>{
    expect(vehicleDisplayLabel('7979')).toBe('7979');
    expect(vehicleDisplayLabel('7979',' ')).toBe('7979');
    expect(vehicleDisplayLabel(null,'Dyna')).toBe('');
  });
  it('does not duplicate an existing suffix',()=>{
    expect(vehicleDisplayLabel('7979 · Dyna','Dyna')).toBe('7979 · Dyna');
  });
});
