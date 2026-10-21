import {useEffect,useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import {supabase} from '@/lib/supabase';
import {formatDate,StatusBadge} from '@/components/ui';
import type {JournalEntry} from '@/types';

type JournalPreviewLine={
 id:string;entry_id:string;account:string|null;account_id:string|null;
 debit:number|string|null;credit:number|string|null;
 party_name:string|null;transport_vehicle_no:string|null;
 transport_vehicle_id:string|null;description:string|null;
};
type Overview={lines:JournalPreviewLine[];debit:number;credit:number;accountsDr:string;accountsCr:string;party:string;vehicles:string;balanced:boolean};
type Props={
 entries:JournalEntry[];
 currency:string;
 copyingId:string|null;
 onCopy:(entry:JournalEntry)=>void;
 onPrint:(entry:JournalEntry)=>void;
};

const money=(value:number,currency:string)=>`${currency||'SAR'} ${value.toLocaleString('en-SA',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const num=(v:number|string|null)=>Number(v??0);
const distinct=(a:string[])=>[...new Set(a.filter(Boolean))];
const displayNames=(items:string[],limit=2)=>items.slice(0,limit).join(' · ')+(items.length>limit?` +${items.length-limit}`:'');
const pageSizes=[25,50,100];

export function buildJournalOverview(lines:JournalPreviewLine[],vehicleNames:Record<string,string>={}):Overview{
 const debit=lines.reduce((n,l)=>n+num(l.debit),0);
 const credit=lines.reduce((n,l)=>n+num(l.credit),0);
 const dr=distinct(lines.filter(l=>num(l.debit)>0).map(l=>l.account?.trim()||l.account_id||'Unassigned account'));
 const cr=distinct(lines.filter(l=>num(l.credit)>0).map(l=>l.account?.trim()||l.account_id||'Unassigned account'));
 const parties=distinct(lines.map(l=>l.party_name?.trim()||''));
 const vehicles=distinct(lines.map(l=>l.transport_vehicle_no?.trim()||(l.transport_vehicle_id?vehicleNames[l.transport_vehicle_id]||'Vehicle mapping unavailable':'')));
 return {lines,debit,credit,accountsDr:displayNames(dr),accountsCr:displayNames(cr),
  party:displayNames(parties,3),vehicles:displayNames(vehicles,3),
  balanced:Math.abs(debit-credit)<0.005};
}

/** Only journal lines on the visible page are fetched. List is read-only and
 * never treats an incomplete line result as a zero-value journal. */
export default function JournalEntryOverview({entries,currency,copyingId,onCopy,onPrint}:Props){
 const [search,setSearch]=useState('');
 const [pageSize,setPageSize]=useState(25);
 const [page,setPage]=useState(1);
 const [expanded,setExpanded]=useState<string[]>([]);
 const [details,setDetails]=useState<Record<string,Overview>>({});
 const [loading,setLoading]=useState(false);
 const [detailError,setDetailError]=useState('');

 const filtered=useMemo(()=>{
  const needle=search.trim().toLowerCase();
  if(!needle)return entries;
  return entries.filter(e=>[e.entry_no,e.description,e.status,e.entry_date].some(x=>String(x??'').toLowerCase().includes(needle)));
 },[entries,search]);
 const totalPages=Math.max(1,Math.ceil(filtered.length/pageSize));
 const safePage=Math.min(page,totalPages);
 const visible=useMemo(()=>filtered.slice((safePage-1)*pageSize,safePage*pageSize),[filtered,safePage,pageSize]);
 const idsKey=visible.map(x=>x.id).join(',');
 useEffect(()=>{setPage(1);setExpanded([])},[search,pageSize]);
 useEffect(()=>{setExpanded([])},[idsKey]);
 useEffect(()=>{
  let cancelled=false;
  const ids=visible.map(e=>e.id);
  if(!ids.length){setDetails({});setLoading(false);setDetailError('');return;}
  setLoading(true);setDetailError('');setDetails({});
  (async()=>{
   const {data,error}=await supabase.from('journal_lines')
    .select('id,entry_id,account,account_id,debit,credit,party_name,transport_vehicle_no,transport_vehicle_id,description')
    .in('entry_id',ids).order('id').limit(1501);
   if(error)throw new Error(error.message||'Unable to load journal lines');
   if((data??[]).length>=1501)throw new Error('More than 1,500 journal lines on this page. Choose a smaller page size.');
   const lines=(data??[]) as JournalPreviewLine[];
   const vehicleIds=distinct(lines.filter(x=>x.transport_vehicle_id&&!x.transport_vehicle_no).map(x=>x.transport_vehicle_id!));
   let names:Record<string,string>={};
   if(vehicleIds.length){
    const result=await supabase.from('transport_vehicles').select('id,vehicle_no').in('id',vehicleIds);
    if(!result.error)names=Object.fromEntries((result.data||[]).map(v=>[v.id,v.vehicle_no]));
   }
   if(cancelled)return;
   const grouped:Record<string,JournalPreviewLine[]>={};
   for(const line of lines)(grouped[line.entry_id]??=[]).push(line);
   const next:Record<string,Overview>={};
   for(const e of visible)if(grouped[e.id]?.length)next[e.id]=buildJournalOverview(grouped[e.id],names);
   setDetails(next);
  })().catch(e=>{if(!cancelled){setDetails({});setDetailError(e instanceof Error?e.message:'Unable to read journal lines.')}})
    .finally(()=>{if(!cancelled)setLoading(false)});
  return()=>{cancelled=true};
 // idsKey is a stable serialization of just this page's journal IDs.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[idsKey]);
 const go=(n:number)=>setPage(Math.max(1,Math.min(n,totalPages)));
 return <div className="space-y-1">
  <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5" data-no-print>
   <div className="flex min-w-[230px] flex-1 items-center gap-2">
    <input aria-label="Search journal numbers and descriptions" className="input w-full max-w-xl" value={search} onChange={e=>setSearch(e.target.value)}
     placeholder="Find entry #, description, status or date…"/>
    <span className="whitespace-nowrap text-xs text-slate-500">{filtered.length} entries</span>
   </div>
   <label className="text-xs text-slate-600">Rows
    <select aria-label="Journal rows per page" className="input ml-1 !h-8 !w-16" value={pageSize} onChange={e=>setPageSize(Number(e.target.value))}>
     {pageSizes.map(n=><option key={n} value={n}>{n}</option>)}
    </select>
   </label>
  </div>
  {detailError&&<div role="alert" className="mx-3 rounded border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800">
   Cannot display the financial details: {detailError}. Journal amounts are not assumed to be zero.
  </div>}
  <div className="overflow-x-auto">
   <table className="w-full min-w-[1050px] table-fixed text-xs" data-report-content data-navilo-customizable="true">
    <colgroup>
     <col style={{width:'12%'}}/><col style={{width:'16%'}}/><col style={{width:'13%'}}/><col style={{width:'13%'}}/>
     <col style={{width:'12%'}}/><col style={{width:'10%'}}/><col style={{width:'8%'}}/><col style={{width:'16%'}}/>
    </colgroup>
    <thead className="bg-slate-50 text-slate-700">
     <tr className="border-b">
      <th scope="col" className="px-2 py-1.5 text-left">Entry # / Date</th>
      <th scope="col" className="px-2 py-1.5 text-left">Description / Type</th>
      <th scope="col" className="px-2 py-1.5 text-left">Debit Account (Dr)</th>
      <th scope="col" className="px-2 py-1.5 text-left">Credit Account (Cr)</th>
      <th scope="col" className="px-2 py-1.5 text-left">Party / Vehicle</th>
      <th scope="col" className="px-2 py-1.5 text-right">Amount (Dr = Cr)</th>
      <th scope="col" className="px-2 py-1.5 text-center">Status</th>
      <th scope="col" className="px-2 py-1.5 text-right">Actions</th>
     </tr>
    </thead>
    <tbody className="divide-y divide-slate-100">
     {visible.map(entry=>{
      const info=details[entry.id],open=expanded.includes(entry.id);
      const toggle=()=>setExpanded(current=>current.includes(entry.id)?current.filter(id=>id!==entry.id):[...current,entry.id]);
      const sourceType=String((entry as JournalEntry&{source_module?:string;trans_type?:string}).source_module||(entry as JournalEntry&{trans_type?:string}).trans_type||'Manual journal');
      return <tr key={entry.id}><td colSpan={8} className="p-0">
       <table className="w-full table-fixed text-xs"><tbody>
        <tr className="hover:bg-slate-50">
         <td className="w-[12%] px-2 py-1 align-middle">
          <Link to={`/accounting/${entry.id}`} className="font-semibold text-blue-700 hover:underline">{entry.entry_no}</Link>
          <div className="text-slate-500 leading-tight">{formatDate(entry.entry_date)}</div>
         </td>
         <td className="w-[16%] px-2 py-1 align-middle">
          <div className="line-clamp-2 max-w-[250px] break-words text-slate-800" title={entry.description||'—'}>{entry.description||'—'}</div>
          <div className="text-[10px] text-slate-500 leading-tight">{sourceType}</div>
         </td>
         <td className="w-[13%] px-2 py-1 align-middle text-slate-700">{info?info.accountsDr||'—':loading?'Loading…':'—'}</td>
         <td className="w-[13%] px-2 py-1 align-middle text-slate-700">{info?info.accountsCr||'—':loading?'Loading…':'—'}</td>
         <td className="w-[12%] px-2 py-1 align-middle">
          {info?.party&&<div className="text-slate-800">Party: {info.party}</div>}
          {info?.vehicles&&<div className="text-blue-800">Vehicle: {info.vehicles}</div>}
          {!info&&!loading?'—':!info?'Loading…':!info.party&&!info.vehicles?'—':null}
         </td>
         <td className="w-[10%] px-2 py-1 text-right align-middle font-semibold tabular-nums">
          {info?<><div>{money(info.debit,currency)}</div>
           {!info.balanced&&<div className="text-rose-700" title="Journal debit and credit do not reconcile">Cr {money(info.credit,currency)} — Check</div>}</>:loading?'Loading…':'—'}
         </td>
         <td className="w-[8%] px-1 py-1 text-center align-middle"><StatusBadge status={entry.status}/></td>
         <td className="w-[16%] px-1 py-1 align-middle">
          <div className="navilo-journal-overview-actions grid grid-cols-2 gap-1">
           <button aria-label={`Show lines for ${entry.entry_no}`} aria-expanded={open} type="button"
            onClick={toggle} disabled={!info} className="min-w-0 rounded border px-1.5 py-1 text-[11px] text-blue-700 disabled:opacity-40">{open?'Hide':'Details'}</button>
           <Link className="min-w-0 rounded border px-1.5 py-1 text-center text-[11px] text-blue-700" to={`/accounting/${entry.id}`}>Open</Link>
           {!entry.entry_no.startsWith('COB-')&&<button className="min-w-0 rounded border px-1.5 py-1 text-[11px]" type="button"
             onClick={()=>onCopy(entry)} disabled={!!copyingId} title="Copy as an editable draft">
             {copyingId===entry.id?'…':'Copy'}</button>}
           <button className="min-w-0 rounded border px-1.5 py-1 text-[11px]" type="button" onClick={()=>onPrint(entry)}>Print</button>
          </div>
         </td>
        </tr>
        {open&&info&&<tr className="bg-slate-50/80"><td colSpan={8} className="px-4 pb-3">
         <div className="mb-2 pt-2 font-semibold text-slate-700">Journal voucher lines · {entry.entry_no}</div>
         <table className="w-full border-collapse border border-slate-200 text-xs">
          <thead><tr className="bg-slate-100 text-left">
           <th className="p-2">Account</th><th className="p-2">Line description</th><th className="p-2">Party</th>
           <th className="p-2">Vehicle</th><th className="p-2 text-right">Debit</th><th className="p-2 text-right">Credit</th>
          </tr></thead>
          <tbody>{info.lines.map(line=><tr key={line.id} className="border-t border-slate-200">
           <td className="p-2">{line.account||line.account_id||'—'}</td>
           <td className="p-2">{line.description||entry.description||'—'}</td>
           <td className="p-2">{line.party_name||'—'}</td>
           <td className="p-2">{line.transport_vehicle_no||'—'}</td>
           <td className="p-2 text-right tabular-nums">{num(line.debit)?money(num(line.debit),currency):'—'}</td>
           <td className="p-2 text-right tabular-nums">{num(line.credit)?money(num(line.credit),currency):'—'}</td>
          </tr>)}</tbody>
          <tfoot><tr className="border-t bg-white font-bold"><td className="p-2" colSpan={4}>TOTAL · {info.lines.length} lines</td>
           <td className="p-2 text-right">{money(info.debit,currency)}</td>
           <td className="p-2 text-right">{money(info.credit,currency)}</td>
          </tr></tfoot>
         </table>
        </td></tr>}
       </tbody></table>
      </td></tr>
     })}
     {!visible.length&&<tr><td colSpan={8} className="p-6 text-center text-slate-500">No matching journal entries.</td></tr>}
    </tbody>
   </table>
  </div>
  <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-slate-50 px-3 py-2 text-xs" data-no-print>
   <span>Showing {filtered.length?(safePage-1)*pageSize+1:0}–{Math.min(safePage*pageSize,filtered.length)} of {filtered.length}. Journal details are read-only.</span>
   <div className="flex gap-2">
    <button className="btn" onClick={()=>go(1)} disabled={safePage===1}>First</button>
    <button className="btn" onClick={()=>go(safePage-1)} disabled={safePage===1}>Previous</button>
    <span className="px-2 py-2 tabular-nums">{safePage} / {totalPages}</span>
    <button className="btn" onClick={()=>go(safePage+1)} disabled={safePage>=totalPages}>Next</button>
    <button className="btn" onClick={()=>go(totalPages)} disabled={safePage>=totalPages}>Last</button>
   </div>
  </div>
 </div>;
}
