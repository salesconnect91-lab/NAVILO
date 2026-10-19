import {recordDisplayText} from '@/lib/recordDisplayText';
import type {ReportTable} from './transportPartyExport';
/** Keep the on-screen row actions aligned with the exact filtered export projection. */
export function visibleReportRows(report:ReportTable,hideZero:boolean):ReportTable['rows']{
 return report.rows.filter(r=>!hideZero||r.slice(0,2).some(v=>/opening|closing|total/i.test(String(v)))||r.some(v=>typeof v==='number'&&Math.abs(v)>=0.005));
}
export function projectReport(report:ReportTable,columns:{key:string;label:string;visible:boolean}[],title:string,hideZero:boolean,hideZeroCells=false):ReportTable{
 const selected=columns.filter(c=>c.visible&&report.columns.includes(c.key));
 const indexes=selected.map(c=>report.columns.indexOf(c.key));
 return {...report,title:recordDisplayText(title.trim()||report.title),description:recordDisplayText(report.description),columns:selected.map(c=>recordDisplayText(c.label||c.key)),rows:visibleReportRows(report,hideZero).map(r=>indexes.map(i=>hideZeroCells&&typeof r[i]==='number'&&Math.abs(Number(r[i]))<0.005?'':typeof r[i]==='string'?recordDisplayText(String(r[i])):r[i]))};
}
