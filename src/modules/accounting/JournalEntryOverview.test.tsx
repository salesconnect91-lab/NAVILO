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
const entry=(i:number,status:'draft'|'posted'='posted'):JournalEntry=>({
 id:`j-${i}`,entry_no:`JE-${i.toString().padStart(5,'0')}`,entry_date:'2026-09-01',
 description:i===1?'Cash customer opening':'Service Sales Invoice',status,
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
 it('shows saved line description in the list when the journal header is blank',async()=>{
  const narration='Al Rajhi Bank-PAID TO PAK FOR CHARITY / USMAN';
  state.lines=rows.map(row=>({...row,description:narration}));
  const journal={...entry(1),description:''};
  render(<MemoryRouter><JournalEntryOverview entries={[journal]} currency="SAR" copyingId={null} onCopy={vi.fn()} onPrint={vi.fn()} postingSelected={false} onPostSelected={vi.fn().mockResolvedValue(true)} deletingSelected={false} onDeleteSelected={vi.fn().mockResolvedValue(true)}/></MemoryRouter>);
  expect(await screen.findByText(narration)).toBeTruthy();
  expect(buildJournalOverview(state.lines as any).description).toBe(narration);
 });
 it('retains separate unique multiline narrations without duplicating both sides',()=>{
  expect(buildJournalOverview(rows.map((row,i)=>({...row,description:i===0?'First\nExcel row':'Second'}))).description).toBe('First\nExcel row\nSecond');
 });
 it('flags unbalanced entries instead of assuming the voucher is correct',()=>{
  expect(buildJournalOverview(rows.slice(0,1)).balanced).toBe(false);
 });
 it('loads lines only for the current journal page and expands complete debit/credit',async()=>{
  render(<MemoryRouter><JournalEntryOverview entries={Array.from({length:31},(_,i)=>entry(i+1))}
   currency="SAR" copyingId={null} onCopy={vi.fn()} onPrint={vi.fn()} postingSelected={false} onPostSelected={vi.fn().mockResolvedValue(true)} deletingSelected={false} onDeleteSelected={vi.fn().mockResolvedValue(true)}/></MemoryRouter>);
  await waitFor(()=>expect(screen.getByText('1120 - Cash')).toBeTruthy());
  expect(state.fetched.filter(x=>x.table==='journal_lines')[0].ids).toHaveLength(25);
  expect(screen.getByText('SAR 150.00')).toBeTruthy();
  expect(screen.getByText('Party: CASH Customer')).toBeTruthy();
  expect(screen.getByText('Vehicle: 7979')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Show lines for JE-00001'}));
  expect(screen.getByText('Journal voucher lines · JE-00001')).toBeTruthy();
  expect(screen.getByText('TOTAL · 2 lines')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Next'}));
  await waitFor(()=>expect(state.fetched.filter(x=>x.table==='journal_lines').slice(-1)[0]?.ids).toHaveLength(6));
  expect(screen.getByText('Showing 26–31 of 31. Journal details are read-only.')).toBeTruthy();
 });
 it('does not present missing journal details as zero when read fails',async()=>{
  state.error=true;
  render(<MemoryRouter><JournalEntryOverview entries={[entry(1)]} currency="SAR"
   copyingId={null} onCopy={vi.fn()} onPrint={vi.fn()} postingSelected={false} onPostSelected={vi.fn().mockResolvedValue(true)} deletingSelected={false} onDeleteSelected={vi.fn().mockResolvedValue(true)}/></MemoryRouter>);
  expect((await screen.findByRole('alert')).textContent).toContain('Database unavailable');
  expect(screen.queryByText('SAR 0.00')).toBeNull();
 });
 it('posts only selected draft entries and leaves posted entries unselectable',async()=>{
  const post=vi.fn().mockResolvedValue(true);
  render(<MemoryRouter><JournalEntryOverview entries={[entry(1,'draft'),entry(2,'draft'),entry(3,'posted')]}
   currency="SAR" copyingId={null} onCopy={vi.fn()} onPrint={vi.fn()} postingSelected={false} onPostSelected={post} deletingSelected={false} onDeleteSelected={vi.fn().mockResolvedValue(true)}/></MemoryRouter>);
  const first=screen.getByRole('checkbox',{name:'Select JE-00001'}) as HTMLInputElement;
  const second=screen.getByRole('checkbox',{name:'Select JE-00002'}) as HTMLInputElement;
  const posted=screen.getByRole('checkbox',{name:'Select JE-00003'}) as HTMLInputElement;
  expect(posted.disabled).toBe(true);
  fireEvent.click(first);
  fireEvent.click(screen.getByRole('button',{name:/Post Selected \(1\)/}));
  await waitFor(()=>expect(post).toHaveBeenCalledWith(['j-1']));
  expect(second.checked).toBe(false);
 });
 it('selects and clears all visible draft rows from the header checkbox',()=>{
  render(<MemoryRouter><JournalEntryOverview entries={[entry(1,'draft'),entry(2,'draft'),entry(3,'posted')]}
   currency="SAR" copyingId={null} onCopy={vi.fn()} onPrint={vi.fn()} postingSelected={false} onPostSelected={vi.fn().mockResolvedValue(true)} deletingSelected={false} onDeleteSelected={vi.fn().mockResolvedValue(true)}/></MemoryRouter>);
  const selectAll=screen.getByRole('checkbox',{name:'Select all visible drafts'});
  fireEvent.click(selectAll);
  expect(screen.getByText('2 draft entries selected')).toBeTruthy();
  fireEvent.click(selectAll);
  expect(screen.queryByText('2 draft entries selected')).toBeNull();
 });
 it('deletes only the selected draft entries after confirmation',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(true);
  const remove=vi.fn().mockResolvedValue(true);
  render(<MemoryRouter><JournalEntryOverview entries={[entry(1,'draft'),entry(2,'draft'),entry(3,'posted')]}
   currency="SAR" copyingId={null} onCopy={vi.fn()} onPrint={vi.fn()} postingSelected={false} onPostSelected={vi.fn().mockResolvedValue(true)} deletingSelected={false} onDeleteSelected={remove}/></MemoryRouter>);
  fireEvent.click(screen.getByRole('checkbox',{name:'Select JE-00001'}));
  fireEvent.click(screen.getByRole('checkbox',{name:'Select JE-00002'}));
  fireEvent.click(screen.getByRole('button',{name:'Delete Selected Drafts (2)'}));
  await waitFor(()=>expect(remove).toHaveBeenCalledWith(['j-1','j-2']));
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Delete 2 selected draft journal entries'));
  confirm.mockRestore();
 });
});
