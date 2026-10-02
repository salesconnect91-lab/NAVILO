// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { isDedicatedTransportContext } from '@/lib/transportMasterContext';
import useTransportMasterClient, { scopeMasterClient } from './useTransportMasterClient';
const mock = vi.hoisted(() => ({ company: {company_id:'c',enabled_modules:['transport']},
 unit: {business_unit_id:'b',business_unit_type:'transport',enabled_modules:['transport']}, from:vi.fn() }));
vi.mock('@/auth/AuthContext',()=>({useAuth:()=>({activeCompany:mock.company,activeBusinessUnit:mock.unit})}));
vi.mock('@/lib/supabase',()=>({supabase:{from:mock.from}}));
afterEach(cleanup);
beforeEach(()=>{mock.unit.business_unit_type='transport';mock.from.mockReset()});
function builder(){const query:any={};for(const method of ['select','update','delete','insert','upsert','eq','order'])query[method]=vi.fn(()=>query);return query}
describe('Transport-only master company/BU isolation',()=>{
 it('requires licensed company and licensed Transport BU',()=>{expect(isDedicatedTransportContext(mock.company,mock.unit)).toBe(true);expect(isDedicatedTransportContext(mock.company,{...mock.unit,enabled_modules:[]})).toBe(false);expect(isDedicatedTransportContext(mock.company,{...mock.unit,business_unit_type:'steel'})).toBe(false)});
 it('keeps AMK/general query behavior unchanged',()=>{mock.unit.business_unit_type='steel';const {result}=renderHook(useTransportMasterClient);const raw:any={};mock.from.mockReturnValue(raw);expect(result.current.from('items')).toBe(raw);expect(mock.from).toHaveBeenCalledWith('items')});
 it('scopes canonical reads, updates and deletes to company, not invented BU fields',()=>{const q=builder();mock.from.mockReturnValue(q);const client=scopeMasterClient({from:mock.from} as any,'c','b');client.from('items').select('*');client.from('customers').update({name:'x'}).eq('id','row');client.from('uom').delete().eq('id','row');expect(q.eq.mock.calls).toEqual([['company_id','c'],['company_id','c'],['company_id','c'],['id','row'],['company_id','c'],['company_id','c'],['id','row']])});
 it('scopes Transport writes and reads by company plus BU',()=>{const q=builder();mock.from.mockReturnValue(q);const client=scopeMasterClient({from:mock.from} as any,'c','b');client.from('transport_drivers').update({is_active:false}).eq('id','d');expect(q.eq.mock.calls).toEqual([['company_id','c'],['business_unit_id','b'],['company_id','c'],['business_unit_id','b'],['id','d']])});
 it('stamps inserts and import batches with the selected scope',()=>{const q=builder();mock.from.mockReturnValue(q);const client=scopeMasterClient({from:mock.from} as any,'c','b');client.from('categories').insert([{name:'Oil',company_id:'wrong'}]);client.from('transport_drivers').insert({driver_name:'Driver',company_id:'wrong',business_unit_id:'wrong'});expect(q.insert.mock.calls).toEqual([[[{name:'Oil',company_id:'c'}]],[{driver_name:'Driver',company_id:'c',business_unit_id:'b'}]])});
 it('does not alter accounting transaction or unrelated clients',()=>{const q=builder();mock.from.mockReturnValue(q);const client=scopeMasterClient({from:mock.from} as any,'c','b');expect(client.from('journal_entries')).toBe(q);expect(q.eq).not.toHaveBeenCalled()});
});
