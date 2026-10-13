import type {PartyLedger} from '@/types';
import type {PartyMovement} from '@/modules/transport/transportPartyReporting';
import {cents} from '@/modules/transport/transportPartyReporting';
export type DetailedPartyLedger = PartyLedger & {party_name?:string|null;transport_order_id?:string;transport_trip_no?:string;source_net?:number;source_gross?:number;source_settled?:number;source_remaining?:number};
const key=(journal:string,side:string,party:string)=>`${journal}:${side}:${party}`;
export const partySearchKey=(text:string)=>text.toLocaleLowerCase().replace(/[\s_-]+/g,' ').trim();
/** Expand the display of an existing posting only when both its debit and credit reconcile.
 * No journal, posting date, allocation, or financial balance is written by this projection.
 */
export function detailedTransportLedger(rows:DetailedPartyLedger[],movements:PartyMovement[],tripDetails:Array<{side:string;order_id?:string|null;trip_no?:string|null}>=[]){
 const groups=new Map<string,DetailedPartyLedger[]>();
 for(const row of rows){if(!row.journal_entry_id)continue;const k=key(row.journal_entry_id,row.party_type,row.party_id);const list=groups.get(k)||[];list.push(row);groups.set(k,list);}
 const events=new Map<string,PartyMovement[]>();const seen=new Set<string>();
 for(const e of movements){if(e.kind!=='opening_balance'||!e.order_id||!e.journal_entry_id||seen.has(e.event_id))continue;seen.add(e.event_id);const k=key(e.journal_entry_id,e.side,e.party_id);const list=events.get(k)||[];list.push(e);events.set(k,list);}
 const output:DetailedPartyLedger[]=[];const handled=new Set<string>();const unmatched:string[]=[];
 const detail=(anchor:DetailedPartyLedger,e:PartyMovement):DetailedPartyLedger=>({...anchor,id:`${anchor.id}:${e.event_id}`,party_name:e.party_name,transport_order_id:e.order_id,reference:e.order_no||e.entry_no,description:e.event_type==='opening_balance'?'Imported invoice opening balance; original invoice date unavailable':e.description,debit:Number(e.debit),credit:Number(e.credit),source_net:e.original_net,source_gross:e.original_gross,source_settled:e.historical_settled,source_remaining:e.event_type==='opening_balance'?e.amount:undefined});
 for(const row of rows){const k=key(row.journal_entry_id||'',row.party_type,row.party_id);const es=events.get(k);if(!es){output.push(row);continue;}if(handled.has(k))continue;handled.add(k);
 const anchors=groups.get(k)!;const sum=(list:Array<{debit:number;credit:number}>,field:'debit'|'credit')=>list.reduce((n,r)=>n+cents(r[field]),0);
 if(sum(anchors,'debit')===sum(es,'debit')&&sum(anchors,'credit')===sum(es,'credit'))output.push(...es.map(e=>detail(anchors[0],e)));
 else {output.push(...anchors);unmatched.push(k);}
 }
 // Fully settled source documents have no posted party line. Show their source evidence
 // with zero ledger effect; the scoped opening API includes only active opening journals.
 for(const [k,es] of events){if(groups.has(k))continue;if(es.some(e=>cents(e.debit)||cents(e.credit)))unmatched.push(k);for(const e of es){if(e.event_type!=='opening_balance'||cents(e.debit)||cents(e.credit))continue;
 output.push(detail({id:`source:${e.event_id}`,user_id:'',party_type:e.side,party_id:e.party_id,entry_date:e.event_date,created_at:e.created_at,description:null,reference:null,debit:0,credit:0,balance:0,journal_entry_id:e.journal_entry_id,journal_line_id:null},e));}}
 output.sort((a,b)=>a.entry_date.localeCompare(b.entry_date)||a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));
 const trips=new Map<string,Set<string>>();for(const t of tripDetails){if(!t.order_id||!t.trip_no)continue;const k=`${t.side}:${t.order_id}`;const values=trips.get(k)||new Set<string>();values.add(t.trip_no);trips.set(k,values);}
 const expanded=output.flatMap(row=>{const values=row.transport_order_id?[...(trips.get(`${row.party_type}:${row.transport_order_id}`)||[])]:[];if(values.length<2)return [row];return values.map((trip,index)=>({...row,id:`${row.id}:trip:${index}`,transport_trip_no:trip,...(index?{debit:0,credit:0,source_net:undefined,source_gross:undefined,source_settled:undefined,source_remaining:undefined,description:'Invoice Trip detail; amounts included in first invoice row'}:{})}));});
 return {rows:expanded,unmatched};
}
