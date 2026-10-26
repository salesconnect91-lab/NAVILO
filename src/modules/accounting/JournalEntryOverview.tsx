import './journalOverviewDensity.css';
import {useEffect,useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import {Copy} from 'lucide-react';
import {supabase} from '@/lib/supabase';
import {formatDate,StatusBadge} from '@/components/ui';
import type {JournalEntry} from '@/types';

type JournalPreviewLine={
 id:string;entry_id:string;account:string|null;account_id:string|null;
 debit:number|string|null;credit:number|string|null;
 party_name:string|null;transport_vehicle_no:string|null;
 transport_vehicle_id:string|null;description:string|null;
};
type Overview={lines:JournalPreviewLine[];debit:number;credit:number;accountsDr:string;accountsCr:string;party:string;vehicles:string;description:string;balanced:boolean};
type Props={
 entries:JournalEntry[];
 currency:string;
 copyingId:string|null;
 onCopy:(entry:JournalEntry)=>void;
 onPrint:(entry:JournalEntry)=>void;
 postingSelected:boolean;
 onPostSelected:(entryIds:string[])=>Promise<boolean>;
 deletingSelected:boolean;
 onDeleteSelected:(entryIds:string[])=>Promise<boolean>;
};

const money=(value:number,currency:string)=>`${currency||'SAR'} ${value.toLocaleString('en-SA',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const num=(v:number|string|null)=>Number(v??0);
const distinct=(a:string[])=>[...new Set(a.filter(Boolean))];
const displayNames=(items:string[],limit=2)=>items.slice(0,limit).join(' · ')+(items.length>limit?` +${items.length-limit}`:'');
const pageSizes=[25,50,100];
const journalColumnDefaults=[12,25,13,12,9,11,7,11];
const journalColumnLabels=['Entry # / Date','Description / Type','Debit Account (Dr)','Credit Account (Cr)','Party','Amount (Dr = Cr)','Status','Actions'];
function journalSavedWidths():number[]{
 try {const raw=JSON.parse(window.localStorage.getItem('navilo:journal:widths-v5')||'[]');return journalColumnDefaults.map((v,i)=>Number.isFinite(raw[i])&&raw[i]>=5&&raw[i]<=50?raw[i]:v);}catch{return [...journalColumnDefaults];}
}


export function buildJournalOverview(lines:JournalPreviewLine[],vehicleNames:Record<string,string>={}):Overview{
 const debit=lines.reduce((n,l)=>n+num(l.debit),0);
 const credit=lines.reduce((n,l)=>n+num(l.credit),0);
 const dr=distinct(lines.filter(l=>num(l.debit)>0).map(l=>l.account?.trim()||l.account_id||'Unassigned account'));
 const cr=distinct(lines.filter(l=>num(l.credit)>0).map(l=>l.account?.trim()||l.account_id||'Unassigned account'));
 const parties=distinct(lines.map(l=>l.party_name?.trim()||''));
 const vehicles=distinct(lines.map(l=>l.transport_vehicle_no?.trim()||(l.transport_vehicle_id?vehicleNames[l.transport_vehicle_id]||'Vehicle mapping unavailable':'')));
 return {lines,debit,credit,accountsDr:displayNames(dr),accountsCr:displayNames(cr),
  party:displayNames(parties,3),vehicles:displayNames(vehicles,3),
  description:distinct(lines.map(line=>line.description?.trim()||'')).join('\n'),
  balanced:Math.abs(debit-credit)<0.005};
}

/** Only journal lines on the visible page are fetched. List is read-only and
 * never treats an incomplete line result as a zero-value journal. */
export default function JournalEntryOverview({entries,currency,copyingId,onCopy,onPrint,postingSelected,onPostSelected,deletingSelected,onDeleteSelected}:Props){
 const [search,setSearch]=useState('');
 const [sort,setSort]=useState<{key:'entry_no'|'entry_date'|'description'|'status';dir:'asc'|'desc'}|null>(null);
 const [statusFilter,setStatusFilter]=useState('all');
 const [dateFrom,setDateFrom]=useState('');
 const [dateTo,setDateTo]=useState('');
 const [columnWidths,setColumnWidths]=useState(journalSavedWidths);
 const [columnOrder,setColumnOrder]=useState<number[]>(()=>{try{const value=JSON.parse(window.localStorage.getItem('navilo:journal:order-v1')||'[]');return Array.isArray(value)&&value.length===8&&new Set(value).size===8&&value.every((x:number)=>Number.isInteger(x)&&x>=0&&x<8)?value:[0,1,2,3,4,5,6,7];}catch{return [0,1,2,3,4,5,6,7];}});
 const [draggedColumn,setDraggedColumn]=useState<number|null>(null);
 const moveColumn=(target:number)=>{if(draggedColumn===null||draggedColumn===target||draggedColumn===7||target===7)return;setColumnOrder(current=>{const next=current.filter(i=>i!==draggedColumn);next.splice(next.indexOf(target),0,draggedColumn);try{window.localStorage.setItem('navilo:journal:order-v1',JSON.stringify(next));}catch{}return next;});setDraggedColumn(null);};
 const resizeJournalColumn=(idx:number,startX:number)=>{
  const start=columnWidths[idx];
  const move=(event:PointerEvent)=>setColumnWidths(prev=>{const next=[...prev];next[idx]=Math.max(5,Math.min(50,start+(event.clientX-startX)/14));try{window.localStorage.setItem('navilo:journal:widths-v1',JSON.stringify(next));}catch{}return next;});
  const stop=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop);
 };
 const [pageSize,setPageSize]=useState(25);
 const [page,setPage]=useState(1);
 const [expanded,setExpanded]=useState<string[]>([]);
 const [details,setDetails]=useState<Record<string,Overview>>({});
 const [loading,setLoading]=useState(false);
 const [detailError,setDetailError]=useState('');
 const [selectedIds,setSelectedIds]=useState<string[]>([]);

 const filtered=useMemo(()=>{
  const needle=search.trim().toLowerCase();
  return entries.filter(e=>(statusFilter==='all'||e.status===statusFilter)&&(!dateFrom||e.entry_date>=dateFrom)&&(!dateTo||e.entry_date<=dateTo)&&(!needle||[e.entry_no,e.description,e.status,e.entry_date].some(x=>String(x??'').toLowerCase().includes(needle))))
   .sort((a,b)=>sort?String(a[sort.key]??'').localeCompare(String(b[sort.key]??''),undefined,{numeric:true})*(sort.dir==='asc'?1:-1):0);
 },[entries,search,statusFilter,dateFrom,dateTo,sort]);
 const totalPages=Math.max(1,Math.ceil(filtered.length/pageSize));
 const safePage=Math.min(page,totalPages);
 const visible=useMemo(()=>filtered.slice((safePage-1)*pageSize,safePage*pageSize),[filtered,safePage,pageSize]);
 const visibleDraftIds=useMemo(()=>visible.filter(entry=>entry.status==='draft').map(entry=>entry.id),[visible]);
 const selectedDraftIds=useMemo(()=>entries.filter(entry=>entry.status==='draft'&&selectedIds.includes(entry.id)).map(entry=>entry.id),[entries,selectedIds]);
 const allVisibleDraftsSelected=visibleDraftIds.length>0&&visibleDraftIds.every(id=>selectedIds.includes(id));
 const someVisibleDraftsSelected=visibleDraftIds.some(id=>selectedIds.includes(id));
 const idsKey=visible.map(x=>x.id).join(',');
 useEffect(()=>{setPage(1);setExpanded([])},[search,pageSize,statusFilter,dateFrom,dateTo]);
 useEffect(()=>{setExpanded([])},[idsKey]);
 useEffect(()=>{
  const draftIds=new Set(entries.filter(entry=>entry.status==='draft').map(entry=>entry.id));
  setSelectedIds(current=>current.filter(id=>draftIds.has(id)));
 },[entries]);
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
 const toggleVisibleDrafts=()=>setSelectedIds(current=>{
  const visibleSet=new Set(visibleDraftIds);
  return allVisibleDraftsSelected?current.filter(id=>!visibleSet.has(id)):[...new Set([...current,...visibleDraftIds])];
 });
 const postSelected=async()=>{
  if(!selectedDraftIds.length||postingSelected)return;
  if(await onPostSelected(selectedDraftIds))setSelectedIds(current=>current.filter(id=>!selectedDraftIds.includes(id)));
 };
 const deleteSelected=async()=>{
  if(!selectedDraftIds.length||postingSelected||deletingSelected)return;
  const count=selectedDraftIds.length;
  if(!window.confirm(`Delete ${count} selected draft ${count===1?'journal entry':'journal entries'} and their lines? This cannot be undone.`))return;
  if(await onDeleteSelected(selectedDraftIds))setSelectedIds(current=>current.filter(id=>!selectedDraftIds.includes(id)));
 };
 return <div className="navilo-je-overview space-y-0">
  <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1" data-no-print>
   <div className="flex min-w-[230px] flex-1 items-center gap-2">
    <input aria-label="Search journal numbers and descriptions" className="input w-full max-w-xl" value={search} onChange={e=>setSearch(e.target.value)}
     placeholder="Find entry #, description, status or date…"/>
    <span className="whitespace-nowrap text-xs text-slate-500">{filtered.length} entries</span>
   </div>
   <label className="text-xs text-slate-600">From <input type="date" aria-label="Journal date from" className="input ml-1 !h-8 !w-[132px]" value={dateFrom} max={dateTo||undefined} onChange={e=>setDateFrom(e.target.value)}/></label>
   <label className="text-xs text-slate-600">To <input type="date" aria-label="Journal date to" className="input ml-1 !h-8 !w-[132px]" value={dateTo} min={dateFrom||undefined} onChange={e=>setDateTo(e.target.value)}/></label>
   <label className="text-xs text-slate-600">Status <select aria-label="Filter journal status" className="input ml-1 !h-8 !w-24" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">All</option><option value="draft">Draft</option><option value="posted">Posted</option></select></label>
   <button type="button" className="rounded border px-2 py-1 text-xs" onClick={()=>{setColumnWidths([...journalColumnDefaults]);setColumnOrder([0,1,2,3,4,5,6,7]);setSort(null);setStatusFilter("all");setDateFrom("");setDateTo("");try{window.localStorage.removeItem("navilo:journal:widths-v1");window.localStorage.removeItem("navilo:journal:order-v1");}catch{}}}>Reset columns</button>
   <label className="text-xs text-slate-600">Rows
    <select aria-label="Journal rows per page" className="input ml-1 !h-8 !w-16" value={pageSize} onChange={e=>setPageSize(Number(e.target.value))}>
     {pageSizes.map(n=><option key={n} value={n}>{n}</option>)}
    </select>
   </label>
  </div>
  {selectedDraftIds.length>0&&<div className="flex flex-wrap items-center justify-between gap-2 border-y border-emerald-200 bg-emerald-50 px-3 py-2" data-no-print>
   <span className="text-xs font-semibold text-emerald-900">{selectedDraftIds.length} draft {selectedDraftIds.length===1?'entry':'entries'} selected</span>
   <div className="flex items-center gap-2">
    <button type="button" className="rounded border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-emerald-100" onClick={()=>setSelectedIds([])} disabled={postingSelected||deletingSelected}>Clear selection</button>
    <button type="button" className="rounded border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50" onClick={()=>void deleteSelected()} disabled={postingSelected||deletingSelected||selectedDraftIds.length===0}>
     {deletingSelected?'Deleting selected…':`Delete Selected Drafts (${selectedDraftIds.length})`}
    </button>
    <button type="button" className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50" onClick={()=>void postSelected()} disabled={postingSelected||deletingSelected||selectedDraftIds.length===0}>
     {postingSelected?'Posting selected…':`✓ Post Selected (${selectedDraftIds.length})`}
    </button>
   </div>
  </div>}
  {detailError&&<div role="alert" className="mx-3 rounded border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800">
   Cannot display the financial details: {detailError}. Journal amounts are not assumed to be zero.
  </div>}
  <div className="overflow-x-auto">
   <table className="w-full table-fixed text-xs" data-report-content data-navilo-customizable="true">
    <colgroup>{columnOrder.map(i=><col key={i} style={{width:`${columnWidths[i]}%`}}/>)}</colgroup>
    <thead className="bg-slate-50 text-slate-700">
     <tr className="border-b">
      {columnOrder.map(i=>([
       <th key={0} draggable={true} onDragStart={()=>setDraggedColumn(0)} onDragOver={e=>e.preventDefault()} onDrop={()=>moveColumn(0)} onDragEnd={()=>setDraggedColumn(null)} title="Drag header to move column; drag right edge to resize" style={{position:'relative'}} scope="col" className="px-2 py-1.5 text-left"><button type="button" aria-label="Sort journals by entry number" onClick={()=>setSort(old=>({key:"entry_no",dir:old?.key==="entry_no"&&old.dir==="asc"?"desc":"asc"}))}>Entry # / Date {sort?.key==="entry_no"?(sort.dir==="asc"?"↑":"↓"):"↕"}</button><span aria-hidden="true" title="Drag to resize" onPointerDown={event=>{event.preventDefault();resizeJournalColumn(0,event.clientX)}} style={{position:'absolute',right:0,top:0,bottom:0,width:6,cursor:'col-resize',touchAction:'none'}}/></th>,
       <th key={1} draggable={true} onDragStart={()=>setDraggedColumn(1)} onDragOver={e=>e.preventDefault()} onDrop={()=>moveColumn(1)} onDragEnd={()=>setDraggedColumn(null)} title="Drag header to move column; drag right edge to resize" style={{position:'relative'}} scope="col" className="px-2 py-1.5 text-left"><button type="button" aria-label="Sort journals by description" onClick={()=>setSort(old=>({key:"description",dir:old?.key==="description"&&old.dir==="asc"?"desc":"asc"}))}>Description / Type {sort?.key==="description"?(sort.dir==="asc"?"↑":"↓"):"↕"}</button><span aria-hidden="true" title="Drag to resize" onPointerDown={event=>{event.preventDefault();resizeJournalColumn(1,event.clientX)}} style={{position:'absolute',right:0,top:0,bottom:0,width:6,cursor:'col-resize',touchAction:'none'}}/></th>,
       <th key={2} draggable={true} onDragStart={()=>setDraggedColumn(2)} onDragOver={e=>e.preventDefault()} onDrop={()=>moveColumn(2)} onDragEnd={()=>setDraggedColumn(null)} title="Drag header to move column; drag right edge to resize" style={{position:'relative'}} scope="col" className="px-2 py-1.5 text-left">Debit Account (Dr)<span aria-hidden="true" title="Drag to resize" onPointerDown={event=>{event.preventDefault();resizeJournalColumn(2,event.clientX)}} style={{position:'absolute',right:0,top:0,bottom:0,width:6,cursor:'col-resize',touchAction:'none'}}/></th>,
       <th key={3} draggable={true} onDragStart={()=>setDraggedColumn(3)} onDragOver={e=>e.preventDefault()} onDrop={()=>moveColumn(3)} onDragEnd={()=>setDraggedColumn(null)} title="Drag header to move column; drag right edge to resize" style={{position:'relative'}} scope="col" className="px-2 py-1.5 text-left">Credit Account (Cr)<span aria-hidden="true" title="Drag to resize" onPointerDown={event=>{event.preventDefault();resizeJournalColumn(3,event.clientX)}} style={{position:'absolute',right:0,top:0,bottom:0,width:6,cursor:'col-resize',touchAction:'none'}}/></th>,
       <th key={4} draggable={true} onDragStart={()=>setDraggedColumn(4)} onDragOver={e=>e.preventDefault()} onDrop={()=>moveColumn(4)} onDragEnd={()=>setDraggedColumn(null)} title="Drag header to move column; drag right edge to resize" style={{position:'relative'}} scope="col" className="px-2 py-1.5 text-left">Party<span aria-hidden="true" title="Drag to resize" onPointerDown={event=>{event.preventDefault();resizeJournalColumn(4,event.clientX)}} style={{position:'absolute',right:0,top:0,bottom:0,width:6,cursor:'col-resize',touchAction:'none'}}/></th>,
       <th key={5} draggable={true} onDragStart={()=>setDraggedColumn(5)} onDragOver={e=>e.preventDefault()} onDrop={()=>moveColumn(5)} onDragEnd={()=>setDraggedColumn(null)} title="Drag header to move column; drag right edge to resize" style={{position:'relative'}} scope="col" className="px-2 py-1.5 text-right">Amount (Dr = Cr)<span aria-hidden="true" title="Drag to resize" onPointerDown={event=>{event.preventDefault();resizeJournalColumn(5,event.clientX)}} style={{position:'absolute',right:0,top:0,bottom:0,width:6,cursor:'col-resize',touchAction:'none'}}/></th>,
       <th key={6} draggable={true} onDragStart={()=>setDraggedColumn(6)} onDragOver={e=>e.preventDefault()} onDrop={()=>moveColumn(6)} onDragEnd={()=>setDraggedColumn(null)} title="Drag header to move column; drag right edge to resize" style={{position:'relative'}} scope="col" className="px-2 py-1.5 text-center"><button type="button" aria-label="Sort journals by status" onClick={()=>setSort(old=>({key:"status",dir:old?.key==="status"&&old.dir==="asc"?"desc":"asc"}))}>Status {sort?.key==="status"?(sort.dir==="asc"?"↑":"↓"):"↕"}</button><span aria-hidden="true" title="Drag to resize" onPointerDown={event=>{event.preventDefault();resizeJournalColumn(6,event.clientX)}} style={{position:'absolute',right:0,top:0,bottom:0,width:6,cursor:'col-resize',touchAction:'none'}}/></th>,
       <th key={7} draggable={false} onDragStart={()=>setDraggedColumn(7)} onDragOver={e=>e.preventDefault()} onDrop={()=>moveColumn(7)} onDragEnd={()=>setDraggedColumn(null)} title="Drag header to move column; drag right edge to resize" style={{position:'relative'}} scope="col" className="px-2 py-1.5 text-right"><span className="inline-flex items-center justify-end gap-1.5"><input type="checkbox" aria-label="Select all visible drafts" checked={allVisibleDraftsSelected} ref={element=>{if(element)element.indeterminate=someVisibleDraftsSelected&&!allVisibleDraftsSelected}} onChange={toggleVisibleDrafts} disabled={!visibleDraftIds.length||postingSelected||deletingSelected} className="h-3.5 w-3.5 accent-emerald-700"/>Actions</span><span aria-hidden="true" title="Drag to resize" onPointerDown={event=>{event.preventDefault();resizeJournalColumn(7,event.clientX)}} style={{position:'absolute',right:0,top:0,bottom:0,width:6,cursor:'col-resize',touchAction:'none'}}/></th>
      ] as React.ReactNode[])[i])}
     </tr>
    </thead>
    <tbody className="divide-y divide-slate-100">
     {visible.map(entry=>{
      const info=details[entry.id],open=expanded.includes(entry.id);
      const description=entry.description?.trim()||info?.description||'';
      const toggle=()=>setExpanded(current=>current.includes(entry.id)?current.filter(id=>id!==entry.id):[...current,entry.id]);
      const sourceType=String((entry as JournalEntry&{source_module?:string;trans_type?:string}).source_module||(entry as JournalEntry&{trans_type?:string}).trans_type||'Manual journal');
      return <tr key={entry.id}><td colSpan={8} className="p-0">
       <table className="w-full table-fixed text-xs"><colgroup>{columnOrder.map(i=><col key={i} style={{width:`${columnWidths[i]}%`}}/>)}</colgroup><tbody>
        <tr className="hover:bg-slate-50">
         {columnOrder.map(i=>([
         <td key={0} style={{width:`${columnWidths[0]}%`}} className="w-[12%] px-2 py-0.5 align-middle">
          <div className="navilo-je-cell-inline"><Link to={`/accounting/${entry.id}`} className="font-semibold text-blue-700 hover:underline truncate" title={entry.entry_no}>{entry.entry_no}</Link><span className="text-slate-500 whitespace-nowrap">{formatDate(entry.entry_date)}</span></div>
         </td>,
         <td key={1} style={{width:`${columnWidths[1]}%`}} className="w-[16%] px-2 py-0.5 align-middle">
          <div className="flex min-w-0 items-center gap-2"><span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-slate-800" title={description||'—'}>{description||(!info&&loading?'Loading…':'—')}</span><span className="max-w-[68px] shrink-0 truncate text-[10px] text-slate-500" title={sourceType}>{sourceType}</span></div>
         </td>,
         <td key={2} style={{width:`${columnWidths[2]}%`}} className="w-[13%] px-2 py-0.5 align-middle text-slate-700"><div className="truncate" title={info?.accountsDr||undefined}>{info?info.accountsDr||'—':loading?'Loading…':'—'}</div></td>,
         <td key={3} style={{width:`${columnWidths[3]}%`}} className="w-[13%] px-2 py-0.5 align-middle text-slate-700"><div className="truncate" title={info?.accountsCr||undefined}>{info?info.accountsCr||'—':loading?'Loading…':'—'}</div></td>,
         <td key={4} style={{width:`${columnWidths[4]}%`}} className="w-[12%] px-2 py-0.5 align-middle">
          {info?.party&&<div className="truncate text-slate-800" title={`Party: ${info.party}`}>Party: {info.party}</div>}
          {info?.vehicles&&<div className="truncate text-slate-700" title={`Vehicle: ${info.vehicles}`}>Vehicle: {info.vehicles}</div>}
          {!info&&!loading?'—':!info?'Loading…':!info.party?'—':null}
         </td>,
         <td key={5} style={{width:`${columnWidths[5]}%`}} className="w-[10%] px-2 py-0.5 text-right align-middle font-semibold tabular-nums">
          {info?<><div>{money(info.debit,currency)}</div>
           {!info.balanced&&<div className="text-rose-700" title="Journal debit and credit do not reconcile">Cr {money(info.credit,currency)} — Check</div>}</>:loading?'Loading…':'—'}
         </td>,
         <td key={6} style={{width:`${columnWidths[6]}%`}} className="w-[8%] px-1 py-0.5 text-center align-middle"><StatusBadge status={entry.status}/></td>,
         <td key={7} style={{width:`${columnWidths[7]}%`}} className="px-1 py-0.5 align-middle whitespace-nowrap">
          <div className="navilo-journal-overview-actions flex flex-nowrap items-center justify-end gap-0.5">
           <input type="checkbox" aria-label={`Select ${entry.entry_no}`} checked={entry.status==='draft'&&selectedIds.includes(entry.id)} onChange={()=>setSelectedIds(current=>current.includes(entry.id)?current.filter(id=>id!==entry.id):[...current,entry.id])} disabled={entry.status!=='draft'||postingSelected||deletingSelected} className="h-3.5 w-3.5 shrink-0 accent-emerald-700"/>
           {!entry.entry_no.startsWith('COB-')&&<button className="min-w-0 rounded border px-1 py-0.5 text-[11px]" type="button"
             onClick={()=>onCopy(entry)} disabled={!!copyingId} aria-label={`Copy ${entry.entry_no} as draft`} title="Copy as an editable draft">
             {copyingId===entry.id?'…':<Copy size={13} aria-hidden="true"/>}</button>}
           <button className="min-w-0 rounded border px-1 py-0.5 text-[11px]" type="button" onClick={toggle} aria-expanded={open} aria-label={`${open?'Hide':'Show'} lines for ${entry.entry_no}`}>{open?'Hide':'Lines'}</button>
           <button className="min-w-0 rounded border px-1 py-0.5 text-[11px]" type="button" onClick={()=>onPrint(entry)}>Print</button>
          </div>
         </td>
         ] as React.ReactNode[])[i])}
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
           <td className="p-2 whitespace-pre-wrap break-words">{line.description||entry.description||'—'}</td>
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
