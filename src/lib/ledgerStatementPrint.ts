import {escapePrintHtml} from './printDocument';

export type LedgerPrintRow={
 date:string; party:string; reference:string; description:string;
 debit:number;credit:number;balance:string;
 trip?:string;from?:string;to?:string;vehicle?:string;invoice?:string;charges?:number|null;vat?:number|null;
};
export type LedgerPrintOptions={
 title:string; companyName?:string;period:string; partySelected:boolean;
 openingBalance?:string;closingBalance?:string;groupLabel?:string; totalDebit:number;totalCredit:number;
};
const safe=escapePrintHtml;
const amt=(v:number)=>Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const content=(v:string)=>safe(v||'—');
/** Compact financial statement first. Supplementary Trip detail appears only when it exists.
 * No amounts are allocated or recomputed from Trip details.
 */
export function ledgerStatementPrintMarkup(rows:LedgerPrintRow[],opts:LedgerPrintOptions):string{
 const multi=!opts.partySelected;
 const hasRef=rows.some(r=>Boolean(r.reference));
 const descriptorColumns=2+(multi?1:0)+(hasRef?1:0);
 const h=(cells:string[])=>'<tr>'+cells.map(c=>'<th scope="col">'+safe(c)+'</th>').join('')+'</tr>';
 const totals=(heading:string, debit:string,credit:string,balance:string)=>'<tr class="acct-total"><td colspan="'+descriptorColumns+'">'+safe(heading)+'</td><td class="acct-number">'+safe(debit)+'</td><td class="acct-number">'+safe(credit)+'</td><td class="acct-number">'+safe(balance)+'</td></tr>';
 const body=rows.map(r=>'<tr>'+
  '<td class="acct-date">'+content(r.date)+'</td>'+
  (multi?'<td>'+content(r.party)+'</td>':'')+
  (hasRef?'<td>'+content(r.reference)+'</td>':'')+
  '<td>'+content(r.description)+'</td>'+
  '<td class="acct-number">'+(r.debit?amt(r.debit):'')+'</td>'+
  '<td class="acct-number">'+(r.credit?amt(r.credit):'')+'</td>'+
  '<td class="acct-number">'+safe(r.balance)+'</td></tr>').join('');
 const opening=opts.partySelected&&opts.openingBalance
   ?'<tr class="acct-subtotal"><td colspan="'+descriptorColumns+'">Opening Balance</td><td></td><td></td><td class="acct-number">'+safe(opts.openingBalance)+'</td></tr>':'';
 const closing=opts.partySelected?(opts.closingBalance??''):'Per Party';
 const summary=totals('Period Total',amt(opts.totalDebit),amt(opts.totalCredit),closing);
 const main='<table class="accounting-statement-table navilo-ledger-financial-table"><thead>'+
  h(['Date',...(multi?[opts.groupLabel??'Party']:[]),...(hasRef?['Reference']:[]),'Description','Debit','Credit','Balance'])+
  '</thead><tbody>'+opening+body+summary+'</tbody></table>';
 const tripRows=rows.filter(r=>[r.trip,r.from,r.to,r.vehicle,r.invoice].some(v=>Boolean(v&&v.trim())));
 const extra=tripRows.length?'<h3 class="acct-support-title">Trip / Invoice Details</h3><p class="acct-support-note">Reference only; amounts above are the posted ledger evidence and are not counted again.</p><table class="accounting-statement-table navilo-ledger-support-table"><thead>'+
  h(['Date','Reference','Trip','From','To','Vehicle','Linked Invoice'])+'</thead><tbody>'+
  tripRows.map(r=>'<tr>'+[r.date,r.reference,r.trip??'',r.from??'',r.to??'',r.vehicle??'',r.invoice??''].map(v=>'<td>'+content(v)+'</td>').join('')+'</tr>').join('')+
  '</tbody></table>':'';
 return '<div class="navilo-ledger-statement" data-print-primary-source data-report-orientation="landscape" data-print-report-title="'+safe(opts.title)+'">'+
   '<h2>'+safe(opts.title)+'</h2>'+
   '<p data-print-description>'+safe(opts.period)+' · SAR · '+safe(opts.companyName??'')+'</p>'+
   main+extra+'</div>';
}
