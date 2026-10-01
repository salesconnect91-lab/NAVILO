import {describe,expect,it} from 'vitest';
import {statement,documentBalances,fifoPreview,reviewedAllocations,type PartyDocument,type PartyMovement} from './transportPartyReporting';
const document=(id:string,outstanding=118):PartyDocument=>({side:'supplier',order_id:id,party_id:'supplier',party_name:'Supplier',order_no:id,order_date:'2026-09-01',trip_ids:[id],trip_no:id,kind:'rent',original_net:100,original_gross:118,journal_entry_id:`j-${id}`,current_billed_gross:118,current_paid_gross:0,current_refunded_gross:0,current_outstanding_gross:outstanding,current_credit_gross:0});
const event=(id:string,date:string,type:string,amount:number,net=amount):PartyMovement=>({event_id:id,side:'supplier',party_id:'supplier',party_name:'Supplier',order_id:'A',order_no:'A',trip_no:'A',journal_entry_id:id,entry_no:id,event_date:date,created_at:`${date}T00:00:00Z`,event_type:type,debit:Math.max(-amount,0),credit:Math.max(amount,0),amount,net_amount:net,description:type});
describe('Transport statements and allocations',()=>{
 it('keeps older partial payments in opening and shows dated reversals only when effective',()=>{
 const rows=[event('bill','2026-09-01','bill',118,100),event('receipt','2026-09-02','payment',-59,-50),event('reverse','2026-10-05','reversal_payment',59,50)];
 const september=statement(rows,'2026-09-02','2026-09-30');expect(september.opening).toBe(118);expect(september.closing).toBe(59);expect(september.rows[0].running).toBe(59);
 expect(statement(rows,'2026-10-01','2026-10-06').closing).toBe(118);
 expect(documentBalances([document('A')],rows,'2026-09-30')[0]).toMatchObject({net:100,vat:18,billed:118,paid:59,outstanding:59});
 expect(documentBalances([document('A')],rows,'2026-10-06')[0].paid).toBe(0);
 });
 it('shows overpayment credits separately and refunds resolve them without rewriting prior allocations',()=>{
 const rows=[event('b','2026-09-01','bill',118,100),event('p','2026-09-02','payment',-118,-100),event('n','2026-09-03','credit_note',-59,-50),event('r','2026-09-04','recovery',59,50)];
 expect(documentBalances([document('A')],rows,'2026-09-03')[0]).toMatchObject({credit:59,outstanding:0,paid:118});
 expect(documentBalances([document('A')],rows,'2026-09-04')[0]).toMatchObject({credit:0,outstanding:0,paid:118,refund:59,billed:59});
 });
 it('calculates money in cents and never carries another bill credit into its outstanding',()=>{
 const a=document('A'),b=document('B');const rows=[event('a','2026-09-01','bill',0.1),event('b','2026-09-01','bill',0.2),event('p','2026-09-01','payment',-0.3),{...event('B','2026-09-01','bill',50),order_id:'B'}];
 expect(statement(rows,'','').closing).toBe(50);const balances=documentBalances([a,b],rows,'');expect(balances[0].outstanding).toBe(0);expect(balances[1].outstanding).toBe(50);
 });
 it('reviews partial payments across Trips only for the exact selected party',()=>{
 expect(reviewedAllocations([document('A'),document('B')],'supplier','supplier',{A:'30',B:'20'})).toEqual({allocations:[{document_id:'A',amount:30},{document_id:'B',amount:20}],total:50});
 for(const amounts of [{A:'119'},{A:'1.001'},{A:'-1'},{A:'Infinity'},{foreign:'10'}])expect(()=>reviewedAllocations([document('A')],'supplier','supplier',amounts)).toThrow();
 expect(()=>reviewedAllocations([document('A')],'customer','supplier',{A:'1'})).toThrow();
 });
 it('prepares FIFO deterministically and includes earlier Trips before later Trips',()=>{
 const a=document('A',50),b={...document('B',40),order_date:'2026-09-02'};
 expect(fifoPreview([b,a],'supplier','supplier','70')).toEqual({A:'50.00',B:'20.00'});
 expect(()=>fifoPreview([a,b],'supplier','supplier','91')).toThrow();
 expect(()=>fifoPreview([a,b],'supplier','other','10')).toThrow();
 });
});
