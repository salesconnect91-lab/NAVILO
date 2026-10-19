import {invoiceImportDate} from '@/modules/transport/transportExternalInvoiceImport';
export type ExpenseImportRow={
 batch_ref:string;supplier_id:string;account_id:string;invoice_date:string;supplier_invoice_no:string;
 description:string;amount:string;vat_choice:'with_vat'|'without_vat';
};
const norm=(v:unknown)=>String(v??'').trim();
const key=(v:string)=>v.toLowerCase().replace(/[^a-z0-9]/g,'');
function field(row:Record<string,unknown>,...labels:string[]){
 const map=new Map(Object.entries(row).map(([k,v])=>[key(k),v]));
 return labels.map(k=>norm(map.get(key(k)))).find(Boolean)??'';
}
function ids(rows:{id:string;name:string}[]):Map<string,string|null>{
 const map=new Map<string,string|null>();
 for(const row of rows){const k=row.name.trim().toLowerCase();map.set(k,map.has(k)?null:row.id)}
 return map;
}
export function parseGeneralExpenseImport(
 raw:Record<string,unknown>[],
 suppliers:{id:string;name:string}[],accounts:{id:string;name:string}[]
):ExpenseImportRow[]{
 if(!raw.length||raw.length>200)throw Error('Import 1–200 rows.');
 const supplierIds=ids(suppliers),accountIds=ids(accounts);
 const groups=new Map<string,string>();
 const result=raw.map((row,index)=>{
  const n=index+2;
  const batch_ref=field(row,'Invoice Group','Group');
  const supplierName=field(row,'Supplier');
  const accountName=field(row,'Expense Account','Expense GL');
  const supplier_id=supplierIds.get(supplierName.toLowerCase());
  const account_id=accountIds.get(accountName.toLowerCase());
  const invoice_date=invoiceImportDate(field(row,'Date','Invoice Date'));
  const supplier_invoice_no=field(row,'Supplier Invoice No','Invoice No','Original Invoice No');
  const description=field(row,'Description');
  const amount=field(row,'Amount','Net Amount').replaceAll(',','');
  const vatField=field(row,'VAT Treatment','VAT').toLowerCase();
  const vat_choice:ExpenseImportRow['vat_choice']=['with vat','with_vat','yes','15','15%'].includes(vatField)?'with_vat':'without_vat';
  if(!batch_ref||batch_ref.length>80)throw Error('Row '+n+': Invoice Group required (max 80).');
  if(!supplier_id||!account_id)throw Error('Row '+n+': Supplier and Expense Account must match active Masters uniquely.');
  if(!supplier_invoice_no||supplier_invoice_no.length>80)throw Error('Row '+n+': original Supplier Invoice No required.');
  if(!description||description.length>1000)throw Error('Row '+n+': expense description required.');
  if(!/^[0-9]{1,12}(\.[0-9]{1,2})?$/.test(amount)||Number(amount)<=0)throw Error('Row '+n+': positive Amount with up to two decimals required.');
  if(vatField&&!['with vat','with_vat','yes','15','15%','without vat','without_vat','no','0','0%'].includes(vatField))throw Error('Row '+n+': VAT Treatment must be With VAT or Without VAT.');
  const group=JSON.stringify({supplier_id,account_id,invoice_date,supplier_invoice_no,vat_choice});
  const old=groups.get(batch_ref.toLowerCase());if(old&&old!==group)throw Error('Row '+n+': conflicting data in Invoice Group '+batch_ref);
  groups.set(batch_ref.toLowerCase(),group);
  return {batch_ref,supplier_id,account_id,invoice_date,supplier_invoice_no,description,amount,vat_choice};
 });
 if(groups.size>50)throw Error('Maximum 50 invoices per file.');
 return result;
}
