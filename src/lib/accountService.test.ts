import {beforeEach,expect,it,vi} from 'vitest';
import {listAccounts,listMappings} from './accountService';
const mock=vi.hoisted(()=>({rows:[] as any[],ranges:[] as number[][],failAt:-1}));
vi.mock('@/lib/supabase',()=>({supabase:{from:()=>{
 const q:any={select:()=>q,order:()=>q};
 q.range=(from:number,to:number)=>{mock.ranges.push([from,to]);return Promise.resolve(from===mock.failAt?{data:null,error:{message:'Page unavailable'}}:{data:mock.rows.slice(from,to+1),error:null});};
 return q;
}}}));
beforeEach(()=>{mock.rows=Array.from({length:1002},(_,i)=>({id:String(i),code:String(i),mapping_key:String(i)}));mock.ranges=[];mock.failAt=-1;});
it.each([['COA',listAccounts],['mappings',listMappings]] as const)('reads %s entries beyond the first API page',async(_name,load)=>{
 const rows=await load();expect(rows).toHaveLength(1002);expect(rows[rows.length-1]?.id).toBe('1001');expect(mock.ranges).toEqual([[0,999],[1000,1999]]);
});
it('does not report a partial COA as complete if the second page fails',async()=>{
 mock.failAt=1000;await expect(listAccounts()).rejects.toThrow('Page unavailable');
});
