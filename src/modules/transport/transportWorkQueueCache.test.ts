import {beforeEach,expect,it} from 'vitest';
import {clearWorkQueueCache,readWorkQueueCache,writeWorkQueueCache,workQueueCacheKey,WORK_QUEUE_CACHE_MS} from './transportWorkQueueCache';
beforeEach(clearWorkQueueCache);
it('reuses only fresh pages for the exact user, business, desk and search',()=>{
  const a=workQueueCacheKey('userA/companyA/unitA','operations',0,'');
  const b=workQueueCacheKey('userB/companyA/unitA','operations',0,'');
  const c=workQueueCacheKey('userA/companyA/unitB','operations',0,'');
  const d=workQueueCacheKey('userA/companyA/unitA','supplier',0,'');
  writeWorkQueueCache(a,[{trip_no:'TR-1'}],true,1000);
  expect(readWorkQueueCache(a,1001)?.rows).toEqual([{trip_no:'TR-1'}]);
  expect(readWorkQueueCache(b,1001)).toBeNull();
  expect(readWorkQueueCache(c,1001)).toBeNull();
  expect(readWorkQueueCache(d,1001)).toBeNull();
  expect(readWorkQueueCache(a,1000+WORK_QUEUE_CACHE_MS+1)).toBeNull();
});
it('limits retained snapshots to avoid an unbounded memory cache',()=>{
  for(let i=0;i<40;i++)writeWorkQueueCache(workQueueCacheKey('user','operations',i,''),[{i}],false,2000);
  expect(readWorkQueueCache(workQueueCacheKey('user','operations',0,''),2001)).toBeNull();
  expect(readWorkQueueCache(workQueueCacheKey('user','operations',39,''),2001)?.rows).toEqual([{i:39}]);
});
