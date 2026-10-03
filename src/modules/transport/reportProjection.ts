import type {ReportTable} from './transportPartyExport';
export function projectReport(report:ReportTable,columns:{key:string;label:string;visible:boolean}[],title:string,hideZero:boolean,hideZeroCells=false):ReportTable{
 const selected=columns.filter(c=>c.visible&&report.columns.includes(c.key));
 const indexes=selected.map(c=>report.columns.indexOf(c.key));
 return {...report,title:title.trim()||report.title,columns:selected.map(c=>c.label||c.key),rows:report.rows.filter(r=>!hideZero||r.slice(0,2).some(v=>/opening|closing|total/i.test(String(v)))||r.some(v=>typeof v==='number'&&Math.abs(v)>=0.005)).map(r=>indexes.map(i=>hideZeroCells&&typeof r[i]==='number'&&Math.abs(Number(r[i]))<0.005?'':r[i]))};
}
