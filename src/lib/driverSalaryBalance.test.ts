import {describe,it,expect} from 'vitest';
import {driverSalaryPosition} from './driverSalaryBalance';
describe('driver salary running account position',()=>{
 it('moves from due from driver to due to driver after salary and trip earnings',()=>{
 expect(driverSalaryPosition(-2000)).toEqual({payable:0,advance:2000,label:'Due from Driver'});
 expect(driverSalaryPosition(-2000+1200+1800)).toEqual({payable:1000,advance:0,label:'Due to Driver'});
 expect(driverSalaryPosition(-2000+1200+1800-1000)).toEqual({payable:0,advance:0,label:'Settled'});
 });
 it('keeps balances per driver so one driver cannot offset another',()=>{
 const positions=[driverSalaryPosition(-2000),driverSalaryPosition(3000)];
 expect(positions.reduce((s,p)=>s+p.advance,0)).toBe(2000);
 expect(positions.reduce((s,p)=>s+p.payable,0)).toBe(3000);
 });
});
