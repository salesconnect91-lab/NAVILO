import {invoiceImportDate} from './transportExternalInvoiceImport';
export type NormalSide='customer'|'supplier';
export type NormalImportVehicle={
 id:string;vehicle_no:string;ownership_type?:string|null;
 ownershipPeriods?:Array<{owner_type:string;effective_from:string;effective_to:string|null}>;
};
export function normalImportVehicleValidOn(vehicle:NormalImportVehicle,date:string):boolean{
 const periods=vehicle.ownershipPeriods;
 if(!periods)return true; // Legacy callers only; production passes dated ownership metadata.
 if(periods.length)return periods.some(o=>o.owner_type==='company'&&o.effective_from<=date&&(!o.effective_to||o.effective_to>=date));
 return vehicle.ownership_type==='company';
}
export type NormalImportRow={
 batch_ref:string;invoice_no:string;invoice_date:string;party_id:string;account_id:string;
 description:string;amount:string;reference:string;vat_choice:'master'|'with_vat'|'without_vat';vehicle_id?:string;
};
const clean=(x:unknown)=>String(x??'').trim();
const key=(x:string)=>x.toLowerCase().replace(/[^a-z0-9]/g,'');
const get=(r:Record<string,unknown>,...keys:string[])=>{
 const normalized=Object.fromEntries(Object.entries(r).map(([k,v])=>[key(k),v]));
 return keys.map(k=>normalized[key(k)]).find(v=>clean(v)!=='')??'';
};
export function parseNormalInvoiceImport(
 raw:Record<string,unknown>[],side:NormalSide,
 parties:Array<{id:string;name:string}>,accountId:string,vehicles:NormalImportVehicle[]=[]
):NormalImportRow[]{
 if(raw.length<1||raw.length>200)throw new Error('Import 1–200 invoice description lines.');
 if(!accountId)throw new Error('Select the company Revenue/Expense Account.');
 const lookup=new Map<string,string|null>();
 for(const party of parties){
  const k=party.name.trim().toLowerCase();
  lookup.set(k,lookup.has(k)?null:party.id);
 }
 const vehicleLookup=new Map<string,NormalImportVehicle|null>();
 for(const v of vehicles){
  const vehicleKey=v.vehicle_no.trim().toLowerCase();
  vehicleLookup.set(vehicleKey,vehicleLookup.has(vehicleKey)?null:v);
 }
 const groups=new Map<string,{party:string;date:string;number:string;reference:string;vat_choice:string}>();
 const numbers=new Map<string,string>();
 const rows=raw.map((row,i)=>{
  const lineNo=i+2;
  const batch_ref=clean(get(row,'Invoice Group','Batch Reference','Group'));
  const invoice_no=clean(get(row,'Invoice No','Invoice Number'));
  const partyName=clean(get(row,side==='customer'?'Customer':'Supplier'));
  const party_id=lookup.get(partyName.toLowerCase());
  const invoice_date=invoiceImportDate(get(row,'Date','Invoice Date'));
  const description=clean(get(row,'Description','Service Description'));
  const vehicleNo=clean(get(row,'Vehicle No','Vehicle Number','Vehicle'));
  const vehicle=vehicleNo?vehicleLookup.get(vehicleNo.toLowerCase()):undefined;
  if(side==='customer'&&!vehicle)throw new Error(`Row ${lineNo}: valid company-owned Vehicle Number from Vehicle Master is required for each Normal Sale line.`);
  if(vehicleNo&&!vehicle)throw new Error(`Row ${lineNo}: Vehicle No does not uniquely match an active company Vehicle Master.`);
  if(vehicle&&!normalImportVehicleValidOn(vehicle,invoice_date))
   throw new Error(`Row ${lineNo}: Vehicle No ${vehicleNo} is not company-owned on invoice date ${invoice_date}. Check Vehicle Ownership History.`);
  const vehicle_id=vehicle?.id;
  const reference=clean(get(row,'Reference','Notes'));
  const choice=clean(get(row,'VAT Treatment','VAT Choice','VAT')).toLowerCase();
  const vat_choice:NormalImportRow['vat_choice']=!choice||choice==='master'||choice==='auto'?'master':['with vat','with_vat','yes','15','15%'].includes(choice)?'with_vat':['without vat','without_vat','no','0','0%'].includes(choice)?'without_vat':'master';
  if(choice&&!['master','auto','with vat','with_vat','yes','15','15%','without vat','without_vat','no','0','0%'].includes(choice))throw new Error('Row '+lineNo+': invalid VAT Treatment');
  const amountInput=clean(get(row,'Amount','Net Amount')).replaceAll(',','');
  if(!batch_ref||batch_ref.length>80)throw new Error(`Row ${lineNo}: Invoice Group (up to 80 characters) required.`);
  if(!party_id)throw new Error(`Row ${lineNo}: ${side==='customer'?'Customer':'Supplier'} must uniquely match an active Master in this company.`);
  if(!/^[0-9]{1,12}(\.[0-9]{1,2})?$/.test(amountInput)||Number(amountInput)<=0)
   throw new Error(`Row ${lineNo}: positive Amount with up to 2 decimals required.`);
  if(!description||description.length>1000)throw new Error(`Row ${lineNo}: Description required (max 1,000 characters).`);
  if(invoice_no.length>80||reference.length>120)throw new Error(`Row ${lineNo}: Invoice No or Reference is too long.`);
  const existing=groups.get(batch_ref.toLowerCase());
  const info={party:party_id,date:invoice_date,number:invoice_no.toLowerCase(),reference:reference.toLowerCase(),vat_choice};
  if(existing&&JSON.stringify(existing)!==JSON.stringify(info))
   throw new Error(`Row ${lineNo}: Invoice Group has inconsistent Master, date, number or Reference.`);
  groups.set(batch_ref.toLowerCase(),info);
  if(invoice_no){
   const k=invoice_no.toLowerCase();
   const other=numbers.get(k);
   if(other&&other!==batch_ref.toLowerCase())
    throw new Error(`Row ${lineNo}: Invoice No is used by two different invoice groups.`);
   numbers.set(k,batch_ref.toLowerCase());
  }
  return {batch_ref,invoice_no,invoice_date,party_id,account_id:accountId,description,amount:amountInput,reference,vat_choice,...(vehicle_id?{vehicle_id}:{})};
 });
 if(groups.size>50)throw new Error('Maximum 50 separate invoices per import batch.');
 return rows;
}
