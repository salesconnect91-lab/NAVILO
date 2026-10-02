import {fetchAllPages} from '@/lib/fetchAllPages';
import {supabase} from '@/lib/supabase';
import type {FinancialTrip} from './transportFinancialTypes';

export type BulkTrip = FinancialTrip & {
 trip_date:string; po_do_job_no?:string|null; owner_supplier_id?:string|null; owner_name?:string|null;
 rent_state?:string|null; rent_finalized_at?:string|null; sales_order_id?:string|null; status?:string|null;
};
export type BulkRent = {id:string;trip_id:string;supplier_id:string;amount:number;state?:string|null;finalized_amount_snapshot?:number|null;supplier_name_snapshot?:string|null};
export type BulkAdjustment = {trip_id:string;rent_id:string|null;side:string;difference:number};
export type BulkLine = {key:string;trip:BulkTrip;rent?:BulkRent;partyId:string;partyName:string;amount:number|null;posted:boolean;legacyBlocked:boolean;finalized:boolean};
export type BulkParty = {id:string;name:string;is_active:boolean};

export async function loadBulkTrips():Promise<BulkTrip[]> {
 return fetchAllPages<BulkTrip>((from)=>supabase.rpc('transport_financial_register_page',{p_limit:1000,p_offset:from}));
}

export function bulkLines(side:'customer'|'supplier',trips:BulkTrip[],rents:BulkRent[],postedRents:Set<string>,adjustments:BulkAdjustment[],parties:BulkParty[]):BulkLine[] {
 const names=new Map(parties.map(p=>[p.id,p.name]));
 const byTrip=new Map<string,BulkRent[]>();
 for(const rent of rents)byTrip.set(rent.trip_id,[...(byTrip.get(rent.trip_id)??[]),rent]);
 return trips.flatMap<BulkLine>(trip=>{
  if(side==='customer')return [{key:trip.id,trip,partyId:trip.customer_id??'',partyName:trip.customer_name??names.get(trip.customer_id??'')??'—',
   amount:trip.billed_customer_net??trip.customer_rate??null,posted:Boolean(trip.customer_rate_locked||trip.invoiced||trip.sales_order_id),legacyBlocked:false,finalized:trip.customer_rate_state==='finalized'}];
  const lines=byTrip.get(trip.id)??[];
  if(lines.length)return lines.map(rent=>({key:rent.id,trip,rent,partyId:rent.supplier_id,partyName:names.get(rent.supplier_id)??rent.supplier_name_snapshot??'—',
   amount:(Math.round(Number(rent.amount)*100)+adjustments.filter(a=>a.side==='supplier'&&a.rent_id===rent.id).reduce((sum,a)=>sum+Math.round(Number(a.difference)*100),0))/100,
   posted:postedRents.has(rent.id),legacyBlocked:false,finalized:rent.state==='finalized'}));
  return [{key:`new:${trip.id}`,trip,partyId:trip.owner_supplier_id??'',partyName:names.get(trip.owner_supplier_id??'')??trip.owner_name??'—',
   amount:trip.supplier_rent??trip.owner_rent??null,posted:Boolean(trip.supplier_rate_locked),
   legacyBlocked:trip.rent_state==='finalized'||Boolean(trip.rent_finalized_at),finalized:false}];
 });
}

export const validBulkMoney=(value:string)=>/^\d+(\.\d{1,2})?$/.test(value)&&Number.isFinite(Number(value))&&Number(value)>=0;
