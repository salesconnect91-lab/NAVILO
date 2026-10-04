// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import AccountMappingSetup from './AccountMappingSetup';
const mock=vi.hoisted(()=>({account:{id:'cash-id',name:'Cash',type:'asset',code:'1110',is_active:true,is_group:false}}));
vi.mock('@/lib/supabase',()=>({supabase:{}}));
vi.mock('@/lib/accountService',async original=>({...await original<any>(),listAccounts:async()=>[mock.account],listMappings:async()=>[{mapping_key:'cash',account_id:'cash-id'}]}));
afterEach(cleanup);
it('marks an invalid mapped account and excludes it from configured count',async()=>{
 mock.account.is_active=false;render(<AccountMappingSetup/>);
 await screen.findByText('Invalid');expect(screen.getByText('0 / 17')).toBeTruthy();expect(screen.queryByText('Mapped')).toBeNull();
});
it('counts a valid active posting account as configured',async()=>{
 mock.account.is_active=true;render(<AccountMappingSetup/>);
 await screen.findByText('Mapped');expect(screen.getByText('1 / 17')).toBeTruthy();expect(screen.queryByText('Invalid')).toBeNull();
});
