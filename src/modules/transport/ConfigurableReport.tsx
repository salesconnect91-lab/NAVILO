import {showPrintDocument,registerPrintSource} from "@/lib/printDocument";
import {accountingStatementLayout,accountingStatementMarkup} from '@/lib/accountingStatementPrint';
import {downloadAccountingReportPdf} from '@/lib/accountingReportPdf';
import {useAuth} from '@/auth/AuthContext';
import {transportRegisteredPrintMarkup} from './transportReportPrint';
import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {exportPartyReport,type ReportTable} from './transportPartyExport';
import {useTransportOutputPermissions} from './useTransportOutputPermissions';
import {financialNumber} from './transportFinancialTypes';
import {projectReport,visibleReportRows} from './reportProjection';
type SourceLink={label:string;href:string};
export default function ConfigurableReport({report,preferenceKey,loadExport,module='transport',outputPrefix='',getRowLinks}:{report:ReportTable;preferenceKey:string;loadExport?:()=>Promise<ReportTable>;module?:string;outputPrefix?:string;getRowLinks?:(sourceRow:ReportTable['rows'][number])=>SourceLink[]}){
 const printRoot=useRef<HTMLElement|null>(null);
 const printRootId='navilo-accounting-report-'+useId().replace(/:/g,'');
 const {activeCompany,activeBusinessUnit}=useAuth();
 const allowed=useTransportOutputPermissions(module);const [error,setError]=useState('');const [exporting,setExporting]=useState(false);const [page,setPage]=useState(0);const [viewIndex,setViewIndex]=useState<number|null>(null);const dragKey=useRef<string|null>(null);
 const [config,setConfig]=useState<{title:string;hideZero:boolean;hideZeroCells?:boolean;columns:{key:string;label:string;visible:boolean}[]}>(()=>{try{return JSON.parse(localStorage.getItem('transport-report:'+preferenceKey)||'null')||{title:'',hideZero:false,columns:[]}}catch{return {title:'',hideZero:false,columns:[]}}});
 const columns=[...config.columns.filter(c=>report.columns.includes(c.key)),...report.columns.filter(k=>!config.columns.some(c=>c.key===k)).map(key=>({key,label:key,visible:true}))];
 const table=useMemo(()=>projectReport(report,columns,config.title,config.hideZero,config.hideZeroCells),[report,columns,config]);
 const sourceRows=useMemo(()=>visibleReportRows(report,config.hideZero),[report,config.hideZero]);
 const viewedRow=viewIndex===null?null:sourceRows[viewIndex]??null;
 const sourceLinks=viewedRow&&getRowLinks?getRowLinks(viewedRow):[];
 useEffect(()=>setViewIndex(null),[preferenceKey,report.title,report.description]);
 function update(next:typeof config){setConfig(next);setPage(0);try{localStorage.setItem('transport-report:'+preferenceKey,JSON.stringify(next))}catch{/* browser storage may be unavailable */}}
 function moveColumn(source:string,target:string){if(source===target)return;const from=columns.findIndex(c=>c.key===source),to=columns.findIndex(c=>c.key===target);if(from<0||to<0)return;const next=[...columns];const [item]=next.splice(from,1);next.splice(to,0,item);update({...config,columns:next})}
 async function output(format:'print'|'pdf'|'xlsx'){
  setExporting(true);setError('');
  try{
   const reportToExport=loadExport?projectReport(await loadExport(),columns,config.title,config.hideZero,config.hideZeroCells):table;
   const identity={companyName:activeCompany?.company_name,businessUnitName:activeBusinessUnit?.business_unit_name};
   if(module==='accounting' && format==='print'){
    // Use the shared print preview so company logo, configured stationery,
    // signatures, pagination and dates match all other NAVILO reports.
    showPrintDocument({selector:`#${printRootId}`});
   } else if(module==='accounting' && format==='pdf'){
    const layout=accountingStatementLayout(reportToExport);
    await downloadAccountingReportPdf({
     fileName:`${reportToExport.title.replace(/[^a-z0-9]+/gi,'-')||'Accounting-Report'}.pdf`,
     title:layout.title,subtitle:layout.subtitle,columns:layout.columns,
     rows:layout.rows.map(row=>row.cells),rowKinds:layout.rows.map(row=>row.kind),
     orientation:layout.orientation,
    });
   } else {
    await exportPartyReport(reportToExport,format,identity);
   }
  }catch(e){setError(e instanceof Error?e.message:'Export failed')}finally{setExporting(false)}
 }
 useEffect(()=>{const root=printRoot.current;if(!root)return;return registerPrintSource(root,async()=>{
   const all=loadExport?projectReport(await loadExport(),columns,config.title,config.hideZero,config.hideZeroCells):table;
   return module==='accounting'?accountingStatementMarkup(all):transportRegisteredPrintMarkup(all);
 })},[table,loadExport,columns,config]);
 const pages=Math.max(1,Math.ceil(table.rows.length/100));const current=Math.min(page,pages-1);
 return <section id={printRootId} ref={printRoot} className="space-y-2"><details className="rounded border p-2"><summary>Customize report headers and columns</summary><label>Report title<input className="input" value={config.title} placeholder={report.title} onChange={e=>update({...config,title:e.target.value})}/></label><label className="ml-3"><input type="checkbox" checked={config.hideZero} onChange={e=>update({...config,hideZero:e.target.checked})}/> Hide zero-value rows</label><label className="ml-3"><input type="checkbox" checked={!!config.hideZeroCells} onChange={e=>update({...config,hideZeroCells:e.target.checked})}/> Hide zero values in cells</label><div className="grid gap-2 md:grid-cols-3">{columns.map((c,i)=><div key={c.key} className="flex gap-1 items-center"><input aria-label={'Show '+c.key} type="checkbox" checked={c.visible} onChange={e=>update({...config,columns:columns.map(x=>x.key===c.key?{...x,visible:e.target.checked}:x)})}/><input aria-label={'Header '+c.key} className="input" value={c.label} onChange={e=>update({...config,columns:columns.map(x=>x.key===c.key?{...x,label:e.target.value}:x)})}/><button className="btn" disabled={i===0} aria-label={'Move '+c.key+' left'} onClick={()=>{const next=[...columns];[next[i-1],next[i]]=[next[i],next[i-1]];update({...config,columns:next})}}>←</button></div>)}</div><button className="btn" onClick={()=>update({title:'',hideZero:false,columns:[]})}>Reset layout</button></details>
 <h3 className="font-semibold">{table.title}</h3><p>{table.description}</p><div className="flex flex-wrap gap-2">{(['print','pdf','xlsx'] as const).map(f=><button className="btn" data-navilo-keep-local-action="true" key={f} disabled={exporting||!table.columns.length||!(f==='print'?allowed.print:allowed.export)} onClick={()=>void output(f)}>{outputPrefix+(f==='xlsx'?'Excel':f.toUpperCase())}</button>)}<button className="btn" disabled={current===0} onClick={()=>setPage(current-1)}>Previous</button><span>Page {current+1} / {pages} · {table.rows.length} rows · Export includes all rows</span><button className="btn" disabled={current+1>=pages} onClick={()=>setPage(current+1)}>Next</button></div>{error&&<p role="alert" className="text-red-700">{error}</p>}
 <div className="max-h-[55vh] overflow-auto"><table className="w-full whitespace-nowrap text-left"><thead><tr>{table.columns.map((c,i)=>{const visible=columns.filter(x=>x.visible);const key=visible[i]?.key??c;return <th className="cursor-grab select-none p-2 active:cursor-grabbing" key={key} draggable onDragStart={e=>{dragKey.current=key;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',key)}} onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='move'}} onDrop={e=>{e.preventDefault();const source=dragKey.current||e.dataTransfer.getData('text/plain');dragKey.current=null;if(source)moveColumn(source,key)}} onDragEnd={()=>{dragKey.current=null}} title="Drag left or right to reorder">{c}</th>})} <th className="sticky right-0 bg-white p-2 text-left">View / Open</th></tr></thead><tbody data-business-data>{table.rows.slice(current*100,(current+1)*100).map((r,i)=><tr className="border-t" key={current*100+i}>{r.map((v,k)=><td className="p-2" key={k}>{typeof v==='number'?financialNumber(v):v}</td>)}<td className="sticky right-0 bg-white p-2"><button type="button" className="btn" aria-label={`View report row ${current*100+i+1}`} onClick={()=>setViewIndex(current*100+i)}>View</button></td></tr>)}</tbody></table></div>
 {viewedRow&&<div role="dialog" aria-modal="true" aria-label="Report row details" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-3" onClick={()=>setViewIndex(null)}><div className="w-full max-w-2xl max-h-[85vh] overflow-auto rounded-xl border bg-white p-4 shadow-xl" onClick={e=>e.stopPropagation()}><div className="mb-3 flex items-center justify-between gap-2"><h4 className="text-base font-semibold">Record details</h4><button type="button" className="btn" onClick={()=>setViewIndex(null)}>Close</button></div><dl className="grid gap-2 sm:grid-cols-2">{report.columns.map((name,i)=><div key={i} className="rounded border p-2"><dt className="text-xs font-semibold text-slate-500">{name}</dt><dd className="whitespace-pre-wrap break-words text-sm">{typeof viewedRow[i]==='number'?financialNumber(viewedRow[i]):String(viewedRow[i]??'')}</dd></div>)}</dl><div className="mt-3 flex flex-wrap gap-2">{sourceLinks.map((link,i)=><a key={i} className="btn" href={link.href} target="_blank" rel="noopener noreferrer">{link.label} ↗</a>)}{sourceLinks.length===0&&<span className="text-xs text-slate-500">No linked posted invoice or voucher for this row.</span>}</div></div></div>}</section>;
}
