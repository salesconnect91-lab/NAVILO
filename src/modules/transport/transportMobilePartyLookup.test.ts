import {describe,it,expect,vi} from 'vitest';
import {loadTransportMobilePartyOptions} from './transportMobilePartyLookup';

describe('Transport Mobile party lookup',()=>{
  for(const table of ['customers','suppliers'] as const){
    it(`${table} uses only the scoped names-only RPC, not direct Master Data SELECT`,async()=>{
      const rpc=vi.fn((_name:string,_args:any)=>({
        range:vi.fn(async()=>({data:[{id:'1',name:'Example',is_active:true}],error:null}))
      }));
      const client={rpc,from:vi.fn(()=>{throw new Error('Direct Master access forbidden')})} as any;
      const result=await loadTransportMobilePartyOptions(table,client);
      expect(result).toEqual([{id:'1',name:'Example',is_active:true}]);
      expect(rpc).toHaveBeenCalledWith('transport_mobile_quick_list_parties',{
        p_party_type:table==='customers'?'customer':'supplier'
      });
      expect(client.from).not.toHaveBeenCalled();
    });
  }
  it('paginates full party lists across the PostgREST default 1000 row limit',async()=>{
    const calls:number[]=[];
    const client={rpc:()=>({
      range:(start:number,_end:number)=>{
        calls.push(start);
        const count=start===0?1000:1;
        return Promise.resolve({data:Array.from({length:count},(_,i)=>({id:String(start+i),name:'Party',is_active:true})),error:null});
      }
    })} as any;
    const rows=await loadTransportMobilePartyOptions('customers',client);
    expect(rows).toHaveLength(1001);
    expect(calls).toEqual([0,1000]);
  });
  it('does not hide permission errors',async()=>{
    const client={rpc:()=>({range:()=>Promise.resolve({data:null,error:{message:'Mobile permission denied'}})})} as any;
    await expect(loadTransportMobilePartyOptions('customers',client)).rejects.toThrow('Mobile permission denied');
  });
});
