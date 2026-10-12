/** Short-lived in-memory snapshots only. Never persisted to disk or shared across sessions. */
export type WorkQueueSnapshot<T>={rows:T[];hasMore:boolean;updatedAt:number};
const cache=new Map<string,WorkQueueSnapshot<unknown>>();
const MAX_ITEMS=36;
export const WORK_QUEUE_CACHE_MS=30_000;
export function workQueueCacheKey(userScope:string,desk:string,page:number,search:string){
  return JSON.stringify([userScope,desk,page,search]);
}
export function readWorkQueueCache<T>(key:string,now=Date.now()):WorkQueueSnapshot<T>|null{
  const entry=cache.get(key);
  if(!entry)return null;
  if(now-entry.updatedAt>WORK_QUEUE_CACHE_MS){cache.delete(key);return null;}
  // Reinsert on access to keep active desks warm.
  cache.delete(key);cache.set(key,entry);
  return entry as WorkQueueSnapshot<T>;
}
export function writeWorkQueueCache<T>(key:string,rows:T[],hasMore:boolean,now=Date.now()){
  cache.delete(key);
  cache.set(key,{rows,hasMore,updatedAt:now});
  if(cache.size>MAX_ITEMS)cache.delete(cache.keys().next().value!);
}
export function clearWorkQueueCache(){cache.clear();}
