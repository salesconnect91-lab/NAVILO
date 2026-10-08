import {describe,expect,it} from 'vitest';
import {calculateFixedDistribution,effectiveRule,previewForMethod,validateDistributionPartners} from './profitDistribution';
const equal=[{key:'usman',name:'Usman',percentage:50},{key:'pk',name:'PK',percentage:50}];
const pools=(own:number,tw:number)=>[{key:'own_fleet' as const,label:'Own fleet',amount:own},{key:'twakkal' as const,label:'Twakkal',amount:tw}];
describe('profit distribution safety',()=>{
 it('splits two independently verified profit pools 50/50',()=>{
   const got=calculateFixedDistribution(equal,pools(80000,20000));
   expect(got.total).toBe(100000);expect(got.lines.map(x=>x.total)).toEqual([50000,50000]);
   expect(got.lines[0].own_fleet).toBe(40000);expect(got.lines[0].twakkal).toBe(10000);
 });
 it('preserves exact cents without dropping rounding residue',()=>{
   const got=calculateFixedDistribution(equal,pools(0.01,0.01));
   expect(got.lines.map(x=>x.total)).toEqual([0.02,0]);
   expect(got.lines.reduce((n,x)=>n+x.total,0)).toBe(got.total);
 });
 it('rejects percentages not exactly 100',()=>expect(()=>validateDistributionPartners([{...equal[0],percentage:60},equal[1]])).toThrow(/100%/));
 it('rejects duplicate partners',()=>expect(()=>validateDistributionPartners([equal[0],equal[0]])).toThrow(/Duplicate/));
 it('rejects negative/NaN profit rather than silently distributing loss',()=>{
   expect(()=>calculateFixedDistribution(equal,pools(-10,20))).toThrow(/Loss sharing/);
   expect(()=>calculateFixedDistribution(equal,pools(Number.NaN,20))).toThrow();
 });
 it('selects the effective-dated rule without borrowing another period',()=>{
   const rs=[{effective_from:'2026-11-01',method:'new'},{effective_from:'2026-09-01',method:'old'}];
   expect(effectiveRule(rs,'2026-10-01')?.method).toBe('old');
   expect(effectiveRule(rs,'2026-08-01')).toBeNull();
 });
 it('blocks Excel-custom calculation until verified formula exists',()=>expect(()=>previewForMethod('custom_excel',equal,pools(100,200))).toThrow(/pending approved formula/));
});
