export function moveJournalRow<T extends {tempId:string}>(rows:T[],sourceId:string,targetIndex:number):T[]{
 const sourceIndex=rows.findIndex(row=>row.tempId===sourceId);
 if(sourceIndex<0||targetIndex<0||targetIndex>=rows.length||sourceIndex===targetIndex)return rows;
 const next=[...rows];const [row]=next.splice(sourceIndex,1);next.splice(targetIndex,0,row);return next;
}
export function compareJournalLineOrder(a:{line_position?:number|null;debit:number;id:string},b:{line_position?:number|null;debit:number;id:string}):number{
 return (a.line_position??Number.MAX_SAFE_INTEGER)-(b.line_position??Number.MAX_SAFE_INTEGER)||Number(Number(b.debit)>0)-Number(Number(a.debit)>0)||a.id.localeCompare(b.id);
}
