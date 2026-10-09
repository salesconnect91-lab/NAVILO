export type VehicleProfitMovement={event_id:string;account_id:string;event_date:string;trip_no?:string;entry_no?:string;category?:string;expense_accounts?:string;revenue:number|string;cost:number|string};
export type VehicleOpeningProfit={vehicle_id:string;month:string;net_profit:number|string;entry_no?:string};
export function vehicleProfitStatement(vehicle:string,from:string,to:string,movements:VehicleProfitMovement[],historical:VehicleOpeningProfit[]){
 const history=historical.filter(h=>h.vehicle_id===vehicle);
 const historicalMonths=new Set(history.map(h=>h.month.slice(0,7)));
 const events=[...movements.filter(r=>r.account_id===vehicle&&(r.category==='Manual journal'||!historicalMonths.has(r.event_date.slice(0,7)))).map(r=>({...r,delta:Number(r.revenue)-Number(r.cost),historical:false})),...history.map(h=>{
  const d=new Date(h.month+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1,0);
  return {event_id:`historical:${h.month}`,account_id:vehicle,event_date:d.toISOString().slice(0,10),trip_no:'',entry_no:h.entry_no||'',category:'Historical opening profit / loss',expense_accounts:'Existing opening equity; not new income',revenue:0,cost:0,delta:Number(h.net_profit),historical:true};
 })].filter(r=>!to||r.event_date<=to).sort((a,b)=>a.event_date.localeCompare(b.event_date)||a.event_id.localeCompare(b.event_id));
 const opening=events.filter(r=>from&&r.event_date<from).reduce((s,r)=>s+r.delta,0);
 const period=events.filter(r=>!from||r.event_date>=from);let running=opening;
 const rows=period.map(r=>({...r,running:running+=r.delta}));
 const revenue=period.reduce((s,r)=>s+Number(r.revenue),0),cost=period.reduce((s,r)=>s+Number(r.cost),0);
 return {opening,historical:period.filter(r=>r.historical).reduce((s,r)=>s+r.delta,0),revenue,cost,closing:running,rows};
}
