export type ImportMasterKind = 'vehicles'|'drivers'|'truck_types'|'locations'|'vehicle_expense_types'|'vehicle_ownership';
export type ImportRateKind = 'customer'|'supplier'|'customer_charge';
type Row = Record<string,unknown>;
const text=(v:unknown)=>String(v??'').trim();
const validDate=(v:unknown)=>/^\d{4}-\d{2}-\d{2}$/.test(text(v)) && !Number.isNaN(Date.parse(text(v)+'T00:00:00Z')) &&
  new Date(text(v)+'T00:00:00Z').toISOString().slice(0,10)===text(v);
const error=(i:number,message:string)=>{throw new Error(`Row ${i+2}: ${message}`)};

export function validateTransportMasterRows(kind:ImportMasterKind,rows:Row[]):void{
 if(!rows.length||rows.length>500)throw Error('Transport master import must contain 1–500 rows.');
 const seen=new Set<string>();
 rows.forEach((r,i)=>{
  const name=text(r.vehicle_no||r.driver_name||r.name);
  if(!name)error(i,'Name/Vehicle No is required.');
  const k=name.toLocaleLowerCase('en');
  if(seen.has(k)&&kind!=='vehicle_ownership')error(i,`Duplicate ${kind} in the file: ${name}`);
  seen.add(k);
  if(kind==='vehicles'||kind==='vehicle_ownership'){
   if(!/^(company|supplier)$/i.test(text(r.owner_type)))error(i,'Owner Type must be Company or Supplier.');
   if(text(r.owner_type).toLowerCase()==='supplier'&&!text(r.supplier))error(i,'Supplier name is required for supplier-owned vehicles.');
   if(!validDate(r.effective_from))error(i,'Effective From must be a valid date.');
   if(kind==='vehicles'&&!text(r.truck_type))error(i,'Truck Type is required.');
   if(kind==='vehicle_ownership'&&text(r.effective_to)){
    if(!validDate(r.effective_to))error(i,'Effective To must be a valid date.');
    if(text(r.effective_to)<text(r.effective_from))error(i,'Effective To cannot precede Effective From.');
   }
  }
  if(kind==='drivers'){
   if(text(r.driver_type).toLowerCase()!=='supplier')error(i,'Company drivers must be linked to an Employee using Driver Details.');
   if(!text(r.supplier))error(i,'Supplier is required for supplier drivers.');
   if(text(r.licence_expiry)&&!validDate(r.licence_expiry))error(i,'Invalid Licence Expiry.');
  }
  if(kind==='vehicle_expense_types'&&!/^(trip|vehicle|both)$/i.test(text(r.expense_scope)))error(i,'Expense Scope must be Trip, Vehicle or Both.');
 });
}

export function validateTransportRateRows(kind:ImportRateKind,rows:Row[]):void{
 if(!rows.length||rows.length>500)throw Error('Transport Rate import must contain 1–500 rows.');
 rows.forEach((r,i)=>{
  if(!text(r.company??r.supplier))error(i,kind==='supplier'?'Supplier is required.':'Customer (Company) is required.');
  if(!validDate(r.effective_from))error(i,'Effective From must be a valid date.');
  if(text(r.effective_to)){
   if(!validDate(r.effective_to))error(i,'Effective To must be a valid date.');
   if(text(r.effective_to)<text(r.effective_from))error(i,'Effective To cannot precede Effective From.');
  }
  if(kind==='customer_charge'){
   if(!text(r.charge_code))error(i,'Charge Code is required.');
   if(!['agreed','pending'].includes(text(r.status).toLowerCase()))error(i,'Status must be Agreed or Pending.');
   if(text(r.status).toLowerCase()==='pending'){
    if(r.amount!==null)error(i,'Pending charge must not include an amount.');
   }else if(typeof r.amount!=='number'||!Number.isFinite(r.amount)||r.amount<0)
    error(i,'Agreed charge Amount must be a valid nonnegative number.');
  }else{
   if(!text(r.truck_type)||!text(r.from)||!text(r.to))error(i,'Truck Type, From and To are required.');
   if(typeof r.amount!=='number'||!Number.isFinite(r.amount)||r.amount<0)error(i,'Rate must be a valid nonnegative number.');
  }
 });
}

/** Limit in-flight read-only checks; preserves result order and the first error. */
export async function mapImportPreviewLimited<T,R>(rows:readonly T[],worker:(row:T,index:number)=>Promise<R>,parallel=6):Promise<R[]>{
 const result=new Array<R>(rows.length);
 let next=0;
 const concurrency=Math.min(Math.max(Math.floor(parallel)||1,1),rows.length);
 await Promise.all(Array.from({length:concurrency},async()=>{
  while(next<rows.length){const index=next++;result[index]=await worker(rows[index],index);}
 }));
 return result;
}
