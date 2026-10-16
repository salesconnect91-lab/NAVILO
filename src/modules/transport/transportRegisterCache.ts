export type CachedRegisterPage={rows:any[];meta:any;at:number;valid:boolean};
export type CachedRegisterOptions={values:string[];at:number;valid:boolean};
export const registerPageCache=new Map<string,CachedRegisterPage>();
export const registerFilterCache=new Map<string,CachedRegisterOptions>();

export function boundedCacheSet<T>(cache:Map<string,T>,key:string,value:T,limit:number){
  cache.delete(key);cache.set(key,value);
  if(cache.size>limit)cache.delete(cache.keys().next().value!);
}

// Retain displayed data while refreshing. Keys include user, workspace,
// operating location and permissions; another scope is never invalidated.
export function invalidateRegisterScope(prefix:string){
  for(const cache of [registerPageCache,registerFilterCache]){
    for(const [key,value] of cache)if(key.startsWith(prefix))value.valid=false;
  }
}
export function clearRegisterSessionCache(){registerPageCache.clear();registerFilterCache.clear();}

export function reconcileRegisterRows<T extends {id:string}>(existing:T[],data:{rows?:T[];rows_delta?:boolean;rows_order?:string[]}):T[]{
  const incoming=data.rows??[];
  if(!data.rows_delta)return incoming;
  if(!Array.isArray(data.rows_order)||new Set(data.rows_order).size!==data.rows_order.length){
    throw new Error('Invalid incremental Register row order. Refresh again.');
  }
  const byId=new Map(existing.map(row=>[String(row.id),row]));
  for(const row of incoming)byId.set(String(row.id),row);
  return data.rows_order.map(id=>{
    const row=byId.get(String(id));
    if(!row)throw new Error('Incremental Register row is missing. Refresh again.');
    return row;
  });
}
