/** Read-only daily closing projection. Never posts or changes ledgers.
 * A cash-to-bank transfer has zero *combined* movement but TWO account
 * movements; this projection shows both sides and reconciles every account. */
export type ClosingAccount={id:string;code?:string|null;name:string;type:string;detail_type?:string|null;account_role?:string|null};
export type ClosingEntry={id:string;entry_no:string;entry_date:string;description:string|null;party_name?:string|null;trans_type?:string|null;created_at?:string|null};
export type ClosingLine={id:string;entry_id:string;account_id:string|null;account?:string|null;debit:number;credit:number;coa?:{id?:string;name:string;type:string;detail_type?:string|null}|null};
export type ClosingBalance={account_id:string;entry_date:string;debit:number|string;credit:number|string};
export type ClosingSummary={opening:number|string;closing:number|string;movement:number|string;difference:number|string};
export type ClosingAccountRow={id:string;code:string;name:string;kind:'Bank'|'Petty Cash'|'Cash';opening:number;received:number;paid:number;closing:number};
export type ClosingMovement={voucher:string;entryId:string;accountId:string;accountName:string;description:string;receipts:number;payments:number;overallRunning:number;accountRunning:number;isTransfer:boolean};
export type ClosingProjection={opening:number;closing:number;grossReceipts:number;grossPayments:number;externalReceipts:number;externalPayments:number;transferAmount:number;accounts:ClosingAccountRow[];movements:ClosingMovement[];voucherCount:number;summaryRows:(string|number)[][];reportRows:(string|number)[][]};

const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
const cashDetails=new Set(['cashonhand','cashandcashequivalents','cash','bank','bankaccount','cashandcashequivalent']);
export function isCashBankAccount(a:Pick<ClosingAccount,'type'|'detail_type'>):boolean{
 return a.type==='asset' && cashDetails.has(String(a.detail_type||'').toLowerCase().replace(/[^a-z0-9]/g,''));
}
function num(v:unknown,label:string):number{
 const n=Number(v);
 if(v==null||String(v).trim()===''||!Number.isFinite(n))throw new Error('Incomplete '+label+' in posted accounting evidence.');
 return n;
}
const approx=(a:number,b:number)=>Math.abs(round(a-b))<0.01;
function kind(a:ClosingAccount):ClosingAccountRow['kind']{
 const role=String(a.account_role||'').toLowerCase(),type=String(a.detail_type||'').toLowerCase();
 if(role==='bank'||type.includes('bank'))return 'Bank';
 if(/petty\s*cash/i.test(a.name))return 'Petty Cash';
 return 'Cash';
}

export function buildDailyClosing(
 date:string,accounts:ClosingAccount[],balances:ClosingBalance[],entries:ClosingEntry[],lines:ClosingLine[],summary:ClosingSummary
):ClosingProjection {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Closing date is required.');
 const byId=new Map(accounts.filter(isCashBankAccount).map(a=>[a.id,a]));
 if(byId.size===0)throw new Error('No Cash or Bank accounts found in the active company Chart of Accounts.');
 const running=new Map<string,number>(),received=new Map<string,number>(),paid=new Map<string,number>();
 for(const id of byId.keys()){running.set(id,0);received.set(id,0);paid.set(id,0);}
 const dayTotals=new Map<string,number>();
 for(const row of balances){
   if(!byId.has(row.account_id))continue;
   const val=round(num(row.debit,'ledger debit')-num(row.credit,'ledger credit'));
   if(row.entry_date<date)running.set(row.account_id,round((running.get(row.account_id)||0)+val));
   else if(row.entry_date===date)dayTotals.set(row.account_id,round((dayTotals.get(row.account_id)||0)+val));
   else throw new Error('Closing balance evidence contains a future ledger date.');
 }
 const openingByAccount=new Map(running);
 const opening=round([...openingByAccount.values()].reduce((a,b)=>a+b,0));
 if(!approx(opening,num(summary.opening,'cash opening')))throw new Error('Daily Cash/Bank opening does not reconcile with posted account ledgers.');
 const entryIdSet=new Set(entries.map(e=>e.id));
 const grouped=new Map<string,ClosingLine[]>();
 for(const line of lines){
  if(!entryIdSet.has(line.entry_id))throw new Error('Voucher line does not match the selected posted day.');
  grouped.set(line.entry_id,[...(grouped.get(line.entry_id)||[]),line]);
 }
 const ordered=[...entries].sort((a,b)=>
   (a.entry_date||'').localeCompare(b.entry_date||'')||
   (a.created_at||'').localeCompare(b.created_at||'')||
   (a.entry_no||'').localeCompare(b.entry_no||'')||a.id.localeCompare(b.id));
 const movements:ClosingMovement[]=[];
 let overall=opening,grossReceipts=0,grossPayments=0,externalReceipts=0,externalPayments=0,transferAmount=0,voucherCount=0;
 for(const entry of ordered){
  const voucherLines=grouped.get(entry.id)||[];
  if(!voucherLines.length)throw new Error('Incomplete posted voucher lines: '+entry.entry_no);
  const cash=new Map<string,{debit:number;credit:number}>();
  const counter=new Set<string>();
  for(const line of voucherLines){
    const id=line.account_id||line.coa?.id||'';
    const d=num(line.debit,'voucher debit'),c=num(line.credit,'voucher credit');
    if(d<0||c<0)throw new Error('Negative journal debit/credit on '+entry.entry_no);
    if(byId.has(id)){
     const old=cash.get(id)||{debit:0,credit:0};cash.set(id,{debit:round(old.debit+d),credit:round(old.credit+c)});
    }else if(Math.abs(d)+Math.abs(c)>=0.005){
     counter.add(line.coa?.name||line.account||'Counter account');
    }
  }
  // Accounting evidence must be complete for each posted voucher, including
  // its non-cash counterlines. Otherwise Cash/Bank numbers may look balanced
  // while missing underlying expense, receivable or bank-control lines.
  const debits=round(voucherLines.reduce((sum,l)=>sum+num(l.debit,'voucher debit'),0));
  const credits=round(voucherLines.reduce((sum,l)=>sum+num(l.credit,'voucher credit'),0));
  if(!approx(debits,credits))throw new Error('Incomplete or unbalanced posted voucher: '+entry.entry_no);
  if(!cash.size)continue;
  voucherCount++;
  const legs=[...cash].map(([id,x])=>({id,in:round(x.debit),out:round(x.credit),net:round(x.debit-x.credit)}));
  const inTotal=round(legs.reduce((a,l)=>a+l.in,0)),outTotal=round(legs.reduce((a,l)=>a+l.out,0));
  const net=round(inTotal-outTotal);
  const transfer=legs.length>1 && inTotal>0 && outTotal>0 && approx(net,0) && counter.size===0;
  if(transfer)transferAmount=round(transferAmount+Math.min(inTotal,outTotal));
  else if(net>0)externalReceipts=round(externalReceipts+net);
  else if(net<0)externalPayments=round(externalPayments-net);
  // Gross receipts/payments are separately shown, including internal transfers.
  grossReceipts=round(grossReceipts+inTotal);grossPayments=round(grossPayments+outTotal);
  overall=round(overall+net);
  const description=[entry.description||entry.trans_type||'Posted voucher',entry.party_name||'',counter.size?[...counter].join(' / '):''].filter(Boolean).join(' · ');
  for(const leg of legs){
   const a=byId.get(leg.id)!;
   running.set(leg.id,round((running.get(leg.id)||0)+leg.net));
   received.set(leg.id,round((received.get(leg.id)||0)+leg.in));
   paid.set(leg.id,round((paid.get(leg.id)||0)+leg.out));
   movements.push({voucher:entry.entry_no,entryId:entry.id,accountId:a.id,accountName:a.name,
    description:transfer?'TRANSFER · '+description:description,
    receipts:leg.in,payments:leg.out,overallRunning:overall,accountRunning:running.get(leg.id)!,isTransfer:transfer});
  }
 }
 const accountRows=[...byId.values()].map(a=>{
  const first=openingByAccount.get(a.id)||0,inc=received.get(a.id)||0,out=paid.get(a.id)||0;
  const actual=round(first+(dayTotals.get(a.id)||0)),derived=running.get(a.id)||0;
  if(!approx(actual,derived))throw new Error('Cash/Bank '+a.name+' does not reconcile with ledger activity.');
  return {id:a.id,code:a.code||'',name:a.name,kind:kind(a),opening:first,received:inc,paid:out,closing:actual};
 }).sort((a,b)=>a.kind.localeCompare(b.kind)||a.name.localeCompare(b.name));
 const closing=round(accountRows.reduce((t,a)=>t+a.closing,0));
 const expected=round(num(summary.closing,'cash closing'));
 if(!approx(expected,closing)||!approx(expected,overall)||!approx(
   num(summary.movement,'cash flow movement'),round(overall-opening))||!approx(num(summary.difference,'cash flow difference'),0))
  throw new Error('Daily closing cash flow does not reconcile with posted ledgers. No final closing report will be printed.');
 const summaryRows:(string|number)[][]=[
  ['OPENING BALANCE','Posted account balances brought forward',0,0,opening,opening],
  ...movements.map(m=>[m.accountName,m.voucher+' · '+m.description,m.receipts,m.payments,m.overallRunning,m.accountRunning]),
  ['TODAY GROSS TOTAL','Includes both sides of internal Cash/Bank transfers',grossReceipts,grossPayments,closing,''],
  ['TODAY RECEIPTS','External net receipts (excludes internal transfers)',externalReceipts,0,'',''],
  ['TODAY PAYMENTS','External net payments (excludes internal transfers)',0,externalPayments,'',''],
  ['INTERNAL TRANSFERS','Bank/Cash transfers between company accounts (not an expense)',transferAmount,transferAmount,'',''],
  ['CLOSING BALANCE','Total posted Cash/Bank balance',0,0,closing,closing],
  ['ACCOUNT-WISE CLOSING','Account / Bank / Petty Cash register','','','',''],
  ...accountRows.map(a=>[a.name,a.kind+' · '+(a.code||'—')+' · Opening '+a.opening.toFixed(2),a.received,a.paid,'',a.closing]),
  ['RECONCILIATION','All bank/cash balances tie to posted vouchers',0,0,closing,closing],
 ];
 return {opening,closing,grossReceipts,grossPayments,externalReceipts,externalPayments,transferAmount,
   accounts:accountRows,movements,voucherCount,summaryRows,reportRows:summaryRows};
}
