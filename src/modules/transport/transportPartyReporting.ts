export type PartySide = 'customer'|'supplier';
export type PartyDocument = {
 side:PartySide;order_id:string;party_id:string;party_name:string;order_no:string;order_date:string;
 trip_ids:string[];trip_no:string;kind:string;original_net:number;original_gross:number;journal_entry_id:string;
 current_billed_gross:number|null;current_paid_gross:number|null;current_refunded_gross:number|null;
 current_outstanding_gross:number|null;current_credit_gross:number|null;
};
export type PartyMovement = {
 event_id:string;side:PartySide;party_id:string;party_name:string;order_id?:string;order_no?:string;
 trip_ids?:string[];trip_no?:string;kind?:string;event_type?:string;journal_entry_id:string;entry_no:string;
 event_date:string;created_at:string;description:string;debit:number;credit:number;amount:number;net_amount?:number;
};
export const cents=(value:unknown)=>Math.round(Number(value??0)*100);
export const money=(value:number)=>value/100;
export function statement(rows:PartyMovement[],from:string,to:string){
 const eligible=rows.filter(r=>(!to||r.event_date<=to)).sort((a,b)=>a.event_date.localeCompare(b.event_date)||a.created_at.localeCompare(b.created_at)||a.event_id.localeCompare(b.event_id));
 let opening=0,running=0,debit=0,credit=0;const period:Array<PartyMovement & {running:number}>=[];
 for(const row of eligible){const amount=cents(row.amount);running+=amount;
 if(from&&row.event_date<from){opening+=amount;continue;}
 debit+=cents(row.debit);credit+=cents(row.credit);period.push({...row,running:money(running)});
 }
 return {opening:money(opening),closing:money(running),debit:money(debit),credit:money(credit),rows:period};
}
export function documentBalances(documents:PartyDocument[],events:PartyMovement[],to:string){
 const totals=new Map<string,{billed:number;net:number;paid:number;refund:number;balance:number}>();
 for(const e of events){if(!e.order_id||(to&&e.event_date>to))continue;
 const v=totals.get(e.order_id)??{billed:0,net:0,paid:0,refund:0,balance:0};
 const a=cents(e.amount);v.balance+=a;
 const type=(e.event_type??'').replace(/^reversal_/,'');
 if(type==='bill'||type==='credit_note'){v.billed+=a;v.net+=cents(e.net_amount);}
 if(type==='receipt'||type==='payment')v.paid-=a;
 if(type==='refund'||type==='recovery')v.refund+=a;
 totals.set(e.order_id,v);
 }
 return documents.filter(d=>!to||d.order_date<=to).map(d=>{const v=totals.get(d.order_id)??{billed:0,net:0,paid:0,refund:0,balance:0};
 return {...d,billed:money(v.billed),net:money(v.net),vat:money(v.billed-v.net),paid:money(v.paid),refund:money(v.refund),
 outstanding:money(Math.max(v.balance,0)),credit:money(Math.max(-v.balance,0)),balance:money(v.balance)};});
}
export function reviewedAllocations(documents:PartyDocument[],side:PartySide,party:string,amounts:Record<string,string>){
 const eligible=new Map(documents.filter(d=>d.side===side&&d.party_id===party).map(d=>[d.order_id,d]));
 const allocations:Array<{document_id:string;amount:number}>=[];let total=0;
 for(const [id,input] of Object.entries(amounts)){if(!input.trim())continue;const value=Number(input);const amount=cents(value);
 if(!Number.isFinite(value)||value<0||Math.abs(value*100-amount)>0.000001)throw new Error('Allocation must be a positive amount with at most two decimals.');
 if(amount===0)continue;const doc=eligible.get(id);
 if(!doc)throw new Error('Allocation outside selected party.');
 if(amount>cents(doc.current_outstanding_gross))throw new Error(`Allocation exceeds outstanding for ${doc.order_no}.`);
 allocations.push({document_id:id,amount:money(amount)});total+=amount;
 }
 allocations.sort((a,b)=>a.document_id.localeCompare(b.document_id));
 return {allocations,total:money(total)};
}
export function fifoPreview(documents:PartyDocument[],side:PartySide,party:string,input:string){
 const value=Number(input);let remaining=cents(value);
 if(!Number.isFinite(value)||remaining<=0||Math.abs(value*100-remaining)>0.000001)throw new Error('Enter a positive FIFO amount with at most two decimals.');
 const amounts:Record<string,string>={};
 for(const d of documents.filter(d=>d.side===side&&d.party_id===party).sort((a,b)=>a.order_date.localeCompare(b.order_date)||a.order_no.localeCompare(b.order_no)||a.order_id.localeCompare(b.order_id))){
 const amount=Math.min(remaining,Math.max(cents(d.current_outstanding_gross),0));
 if(amount){amounts[d.order_id]=money(amount).toFixed(2);remaining-=amount;}
 }
 if(remaining>0)throw new Error('FIFO amount exceeds eligible outstanding.');
 return amounts;
}
