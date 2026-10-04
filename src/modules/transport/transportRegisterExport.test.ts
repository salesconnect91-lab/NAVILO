import {describe,expect,it} from 'vitest';
import {collectRegisterExport} from './transportRegisterExport';
const page=(offset:number,count=1001,snapshot='same')=>({rows:Array.from({length:Math.max(0,Math.min(500,count-offset))},(_,i)=>({id:String(offset+i)})),count,snapshot,totals:{amount:count}});
describe('Complete filtered register export',()=>{
 it('collects all pages and the final row with matching full totals',async()=>{const calls:number[]=[];const r=await collectRegisterExport(async offset=>{calls.push(offset);return page(offset)},new AbortController().signal,()=>{});expect(r.rows).toHaveLength(1001);expect(r.rows[r.rows.length-1]?.id).toBe('1000');expect(r.totals.amount).toBe(1001);expect(calls).toEqual([0,500,1000,0]);});
 it.each([501,1000,20000])('exports every filtered row for %i records',async count=>{const r=await collectRegisterExport(async offset=>page(offset,count),new AbortController().signal,()=>{});expect(r.rows).toHaveLength(count);expect(r.rows[r.rows.length-1]?.id).toBe(String(count-1));expect(r.totals.amount).toBe(count)});
 it('rejects concurrent changes rather than producing mixed rows/totals',async()=>{await expect(collectRegisterExport(async offset=>page(offset,1001,offset?'changed':'same'),new AbortController().signal,()=>{})).rejects.toThrow('changed');});
 it('rejects truncated and duplicated pages',async()=>{await expect(collectRegisterExport(async offset=>({...page(offset),rows:offset?[]:page(offset).rows}),new AbortController().signal,()=>{})).rejects.toThrow('Incomplete');await expect(collectRegisterExport(async()=>page(0),new AbortController().signal,()=>{})).rejects.toThrow('Duplicate');});
 it('honors cancellation before reading',async()=>{const c=new AbortController();c.abort();await expect(collectRegisterExport(async offset=>page(offset),c.signal,()=>{})).rejects.toThrow();});
});
