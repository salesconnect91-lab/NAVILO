// Department-specific column projections. No data mutation or status inference.
// Existing per-user column preferences apply only to the original All Trips view.
export const transportWorkDesks=[
  {key:'all',label:'All Trips / Report'},
  {key:'operations',label:'Trip Operations'},
  {key:'billing',label:'Customer Billing'},
  {key:'supplier',label:'Supplier Desk'},
  {key:'payments',label:'Payments Desk'},
  {key:'ppr',label:'PPR & Papers'},
] as const;
export type TransportWorkDesk=(typeof transportWorkDesks)[number]['key'];
const deskColumns:Record<Exclude<TransportWorkDesk,'all'>,readonly string[]>={
  operations:['trip_no','trip_date','truck_type','job_no','company','driver','plate','owner','from','to','paper_received_by'],
  billing:['trip_no','trip_date','job_no','company','from','to','invoice_no','sale_type','charge','company_rate','received_company','remaining_company','customer_credit'],
  supplier:['trip_no','trip_date','job_no','company','from','to','plate','owner','supplier_invoice_no','supplier_charges','rent_driver','supplier_paid','supplier_balance','supplier_credit','commission'],
  payments:['trip_no','trip_date','company','owner','invoice_no','supplier_invoice_no','company_rate','received_company','remaining_company','customer_credit','rent_driver','supplier_paid','supplier_balance','supplier_credit','payment_date','amount'],
  ppr:['trip_no','trip_date','job_no','company','driver','plate','from','to','paper_received_by'],
};
export function resolveTransportDesk(value:string|null):TransportWorkDesk{
  return transportWorkDesks.find(d=>d.key===value)?.key??'all';
}
export function workDeskColumnVisible(desk:TransportWorkDesk,key:string,hiddenColumns:readonly string[]):boolean{
  return desk==='all'?!hiddenColumns.includes(key):deskColumns[desk].includes(key);
}
