import {describe,it,expect} from 'vitest';
import {projectReport} from './reportProjection';
describe('Shared screen/export report projection',()=>{
 it('hides zero cells in the same projection used by every export',()=>{const r={title:'Report',description:'',columns:['Trip','Revenue','Cost'],rows:[['A',100,0]]};expect(projectReport(r,r.columns.map(key=>({key,label:key,visible:true})),'',false,true).rows).toEqual([['A',100,'']])});
 it('preserves zero-opening and totals while filtering zero records, renaming and reordering headers',()=>{
 const r={title:'Report',description:'Same evidence',columns:['Trip','Revenue','Cost'],rows:[['Opening',0,0],['A',0,0],['B',100,80],['TOTAL',100,80]]};
 const result=projectReport(r,[{key:'Cost',label:'Trip expense',visible:true},{key:'Trip',label:'Trip number',visible:true},{key:'Revenue',label:'Income',visible:false}],'Fleet account',true);
 expect(result.columns).toEqual(['Trip expense','Trip number']);expect(result.rows).toEqual([[0,'Opening'],[80,'B'],[80,'TOTAL']]);expect(result.title).toBe('Fleet account');expect(r.rows).toHaveLength(4);
 });
});
