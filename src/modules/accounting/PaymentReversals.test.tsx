// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import PaymentReversals from './PaymentReversals';
const mock=vi.hoisted(()=>({queries:[] as any[],rpc:vi.fn(),extraLines:false}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc,from:(table:string)=>{
 const filters:any={table,ids:[],reversal:false};mock.queries.push(filters);
 const q:any={select:()=>q,order:()=>q,eq:()=>q,or:(s:string)=>{filters.search=s;return q;},in:(field:string,values:string[])=>{if(field==='trans_type')filters.reversal=values[0].includes('Reversal');else filters.ids=values;return q;}};
 q.range=async(from:number,to:number)=>{filters.range=[from,to];let data:any[]=[];
 if(table==='journal_lines')data=filters.ids.flatMap((id:string)=>[{entry_id:id,debit:100,credit:0},...(mock.extraLines&&id==='v0'?Array.from({length:1001},(_,i)=>({entry_id:id,debit:i===1000?999:1,credit:0})):[])]);
 else if(filters.reversal)data=filters.ids.includes('v0')?[{id:'r-old',entry_no:'REV-OLD',entry_date:'2026-01-01',reversal_of_entry_id:'v0'}]:[];
 else data=Array.from({length:501},(_,i)=>({id:`v${i}`,entry_no:`PAY-${i}`,entry_date:'2026-01-01',trans_type:'Supplier Payment',party_name:'Supplier',payment_mode:'Cash'}));
 return {data:data.slice(from,to+1),count:filters.search?501:501,error:null};};return q;
}}}));
beforeEach(()=>{mock.queries=[];mock.rpc.mockReset();mock.extraLines=false;});afterEach(cleanup);
it('finds vouchers beyond the latest 250 and checks reversals against the displayed voucher IDs',async()=>{
 render(<PaymentReversals/>);await screen.findByText('Reversed: REV-OLD');
 expect(mock.queries.find(q=>q.reversal)?.ids).toContain('v0');
 fireEvent.click(screen.getByRole('button',{name:'Last'}));await screen.findByText('PAY-500');
 expect(mock.queries.some(q=>q.table==='journal_entries'&&!q.reversal&&q.range?.[0]===500)).toBe(true);
 fireEvent.change(screen.getByPlaceholderText('Search voucher, party, method...'),{target:{value:'old,100%'}});
 await waitFor(()=>expect(mock.queries.some(q=>q.search?.includes('old,100')&&q.range?.[0]===0)).toBe(true));
 expect(mock.rpc).not.toHaveBeenCalled();
});
it('reads payment lines beyond the API page limit',async()=>{
 mock.extraLines=true;render(<PaymentReversals/>);await screen.findByText('Rs 999.00');
 expect(mock.queries.some(q=>q.table==='journal_lines'&&q.range?.[0]===1000)).toBe(true);
});
it('recovers the reversal form after a rejected network request',async()=>{
 mock.rpc.mockRejectedValue(new Error('Connection lost'));render(<PaymentReversals/>);await screen.findByText('PAY-1');
 fireEvent.click(screen.getAllByRole('button',{name:'Reverse'})[0]);
 fireEvent.change(screen.getByPlaceholderText('Wrong amount / wrong party / bank entry correction...'),{target:{value:'Correction'}});
 fireEvent.click(screen.getByRole('button',{name:'Post Reversal'}));await screen.findByText('Connection lost');
 expect((screen.getByRole('button',{name:'Post Reversal'}) as HTMLButtonElement).disabled).toBe(false);
});
