// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import JournalEntryOverview,{buildJournalOverview} from './JournalEntryOverview';
import type {JournalEntry} from '@/types';

const state=vi.hoisted(()=>({
 fetched:[] as {table:string;ids:string[]}[],
 lines:[] as Record<string,unknown>[],
 error:false,
}));
vi.mock('@/lib/supabase',()=>({supabase:{
 from:(table:string)=>{
  const query:any={ids:[] as string[]};
  query.select=()=>query;
  query.in=(_field:string,ids:string[])=>{query.ids=ids;return query;};
  query.order=()=>query;
  query.limit=async(n:number)=>{
   state.fetched.push({table,ids:query.ids});
   return state.error?{data:null,error:{message:'Database unavailable'}}:
    {data:table==='journal_lines'?state.lines.filter(line=>query.ids.includes(String(line.entry_id))).slice(0,n):[],error:null};
  };
  return query;
 }
}}));
const entry=(i:number):JournalEntry=>({
 id:`j-${i}`,entry_no:`JE-${i.toString().padStart(5,'0')}`,entry_date:'2026-09-01',
 description:i===1?'Cash customer opening':'Service Sales Invoice',status:'posted',
}) as JournalEntry;
const rows=[
 {id:'l1',entry_id:'j-1',account:'1120 - Cash',account_id:'cash',debit:150,credit:0,
  party_name:'CASH Customer',transport_vehicle_no:null,transport_vehicle_id:null,description:'Opening'},
 {id:'l2',entry_id:'j-1',account:'4100 - Sales Revenue',account_id:'income',debit:0,credit:150,
  party_name:null,transport_vehicle_no:'7979',transport_vehicle_id:null,description:null},
];
beforeEach(()=>{state.fetched=[];state.lines=rows;state.error=false});
afterEach(cleanup);

describe('Journal Entry list detailed preview',()=>{
 it('shows balanced account, amount, party, and vehicle without opening each journal',()=>{
  const result=buildJournalOverview(rows);
  expect(result).toMatchObject({
   debit:150,credit:150,accountsDr:'1120 - Cash',accountsCr:'4100 - Sales Revenue',
   party:'CASH Customer',vehicles:'7979',balanced:true
  });
 });
 it('flags unbalanced entries instead of assuming the voucher is correct',()=>{
  expect(buildJournalOverview(rows.slice(0,1)).balanced).toBe(false);
 });
 it('loads lines only for the current journal page and expands complete debit/credit',async()=>{
  render(<MemoryRouter><JournalEntryOverview entries={Array.from({length:31},(_,i)=>entry(i+1))}
   currency="SAR" copyingId={null} onCopy={vi.fn()} onPrint={vi.fn()}/></MemoryRouter>);
  await waitFor(()=>expect(screen.getByText('1120 - Cash')).toBeTruthy());
  expect(state.fetched.filter(x=>x.table==='journal_lines')[0].ids).toHaveLength(25);
  expect(screen.getByText('SAR 150.00')).toBeTruthy();
  expect(screen.getByText('Party: CASH Customer')).toBeTruthy();
  expect(screen.getByText('Vehicle: 7979')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Show lines for JE-00001'}));
  expect(screen.getByText('Journal voucher lines · JE-00001')).toBeTruthy();
  expect(screen.getByText('TOTAL · 2 lines')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Next'}));
  await waitFor(()=>expect(state.fetched.filter(x=>x.table==='journal_lines').at(-1)?.ids).toHaveLength(6));
  expect(screen.getByText('Showing 26–31 of 31. Journal details are read-only.')).toBeTruthy();
 });
 it('does not present missing journal details as zero when read fails',async()=>{
  state.error=true;
  render(<MemoryRouter><JournalEntryOverview entries={[entry(1)]} currency="SAR"
   copyingId={null} onCopy={vi.fn()} onPrint={vi.fn()}/></MemoryRouter>);
  expect((await screen.findByRole('alert')).textContent).toContain('Database unavailable');
  expect(screen.queryByText('SAR 0.00')).toBeNull();
 });
});
