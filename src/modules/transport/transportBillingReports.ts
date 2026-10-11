import type {ReportTable} from './transportPartyExport';
export function billingReport(report:ReportTable,withoutVat:boolean):ReportTable{
 if(!withoutVat)return report;
 const keep=report.columns.map((c,i)=>/\bVAT\b/i.test(c)?-1:i).filter(i=>i>=0);
 return {...report,columns:keep.map(i=>report.columns[i].replace(/\bGross after credits\b/i,'Bill amount').replace(/\bgross\b/gi,'amount').replace(/\bNet after credits\b/i,'Amount after credits')),rows:report.rows.map(row=>keep.map(i=>row[i]))};
}
export function hasOnlyWithoutVatDocuments(documents:Array<{original_net:number;original_gross:number}>){
 return documents.length>0&&documents.every(d=>Math.round(Number(d.original_net)*100)===Math.round(Number(d.original_gross)*100));
}
