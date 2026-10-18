/** Financial presentation only: date filtered entries must carry pre-period posted movements. */
export type LedgerMovement={debit:number|string|null|undefined;credit:number|string|null|undefined};
export const amount=(v:number|string|null|undefined)=>Number(v)||0;
export const movement=(row:LedgerMovement)=>amount(row.debit)-amount(row.credit);

export function withOpeningBalances<T extends LedgerMovement>(
 rows:readonly T[], opening:Record<string,number>, accountOrPartyKey:(row:T)=>string,
):Array<T&{displayBalance:number}>{
 const running=new Map<string,number>();
 return rows.map(row=>{
  const key=accountOrPartyKey(row);
  const next=(running.has(key)?running.get(key)!:(opening[key]??0))+movement(row);
  running.set(key,next);
  return {...row,displayBalance:next};
 });
}
export function statementClosing(opening:number,rows:readonly LedgerMovement[]):number{
 return rows.reduce((sum,row)=>sum+movement(row),opening);
}
