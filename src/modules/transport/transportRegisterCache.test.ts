import {afterEach,expect,it} from 'vitest';
import {clearRegisterSessionCache,invalidateRegisterScope,reconcileRegisterRows,registerPageCache,registerFilterCache} from './transportRegisterCache';
afterEach(clearRegisterSessionCache);
it('merges new and edited Trips, removes deleted Trips and follows the server order by ID',()=>{
 const unchanged={id:'a',amount:10},edited={id:'b',amount:25},added={id:'d',amount:40};
 const result=reconcileRegisterRows([unchanged,{id:'b',amount:20},{id:'c',amount:30}],{
  rows_delta:true,rows_order:['d','b','a'],rows:[edited,added]
 });
 expect(result).toEqual([added,edited,unchanged]);expect(result[2]).toBe(unchanged);
});
it('never assigns amounts when an incremental response omits an unknown Trip',()=>{
 expect(()=>reconcileRegisterRows([{id:'a',amount:10}],{rows_delta:true,rows_order:['different-trip'],rows:[]})).toThrow('missing');
 expect(()=>reconcileRegisterRows([{id:'a'}],{rows_delta:true,rows_order:['a','a'],rows:[]})).toThrow('row order');
});
it('invalidates only the matching user/workspace while retaining rows and options',()=>{
 const rows=[{id:'a'}];
 registerPageCache.set('user:company:page=0',{rows,meta:{},at:1,valid:true});
 registerPageCache.set('other:company:page=0',{rows:[],meta:{},at:1,valid:true});
 registerFilterCache.set('user:company:driver',{values:['Driver'],at:1,valid:true});
 invalidateRegisterScope('user:company:');
 expect(registerPageCache.get('user:company:page=0')).toMatchObject({rows,valid:false});
 expect(registerFilterCache.get('user:company:driver')).toMatchObject({values:['Driver'],valid:false});
 expect(registerPageCache.get('other:company:page=0')?.valid).toBe(true);
});
