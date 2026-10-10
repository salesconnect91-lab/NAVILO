export type ExternalInvoiceRow={source_reference:string;invoice_no:string;invoice_date:string;customer:string;sale_type:'Cash'|'Credit';vehicle_no:string;amount:number;tax_percent:number;tax_amount:number;bill_amount:number;description:string;reference_trip_no:string;reference_date:string;truck_type:string;job_no:string;driver_name:string;owner_name:string;from_location:string;to_location:string};
const text=(v:unknown)=>String(v??'').trim();
const key=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
export function invoiceImportDate(value:unknown):string{
 if(value instanceof Date&&!Number.isNaN(value.valueOf()))return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
 if(typeof value==='number')return new Date(Math.round((value-25569)*86400000)).toISOString().slice(0,10);
 const s=text(value);if(!s)return '';
 let result=s;const match=s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/);
 if(match){const m=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(match[2].toLowerCase())+1;result=`${match[3].length===2?'20':''}${match[3]}-${String(m).padStart(2,'0')}-${match[1].padStart(2,'0')}`;}
 if(!/^\d{4}-\d{2}-\d{2}$/.test(result)||!Number.isFinite(Date.parse(result))||new Date(result).toISOString().slice(0,10)!==result)throw new Error(`Invalid date: ${s}. Use dd-mmm-yy or yyyy-mm-dd.`);
 return result;
}
export function parseExternalInvoiceRows(raw:Record<string,unknown>[]):ExternalInvoiceRow[]{
 if(!raw.length||raw.length>500)throw new Error('Choose a file containing 1 to 500 invoice lines.');
 const references=new Set<string>();
 const rows=raw.map((r,index)=>{
  const n=Object.fromEntries(Object.entries(r).map(([k,v])=>[key(k),v]));const pick=(...keys:string[])=>keys.map(k=>n[key(k)]).find(v=>v!==undefined&&v!==null&&text(v)!=='');
  const number=(label:string,...keys:string[])=>{const v=pick(...keys);if(v===undefined)throw new Error(`Row ${index+2}: ${label} is required.`);const result=Number(typeof v==='string'?v.replaceAll(',',''):v);if(!Number.isFinite(result)||result<0||Math.abs(result*100-Math.round(result*100))>0.000001)throw new Error(`Row ${index+2}: invalid ${label}.`);return result;};
  const reference=text(pick('Source Reference','TRIP NO.'));const sale=text(pick('Cash/Credit','Sale Type'));const rawInvoice=text(pick('INVOICED','Invoice No'));const invoice=/^cleared\b/i.test(rawInvoice)?'':rawInvoice;
  const row:ExternalInvoiceRow={source_reference:reference,invoice_no:invoice,invoice_date:invoiceImportDate(pick('Invoice / Bill Date','Invoice Date')),customer:text(pick('COMPANY NAME','Customer')),sale_type:/^cash$/i.test(sale)?'Cash':'Credit',vehicle_no:text(pick('PLATE #','Vehicle No')),amount:number('Amount','RATE WITH COMPANY','Amount'),tax_percent:number('Tax (%)','TAX (%)','Tax Percent'),tax_amount:number('Tax Amount','TAX AMOUNT'),bill_amount:number('Bill Amount','BILL AMOUNT'),description:text(pick('Discription','Description')),reference_trip_no:text(pick('TRIP NO.')),reference_date:invoiceImportDate(pick('DATE','Reference Date')),truck_type:text(pick('TRUCK TYPE')),job_no:text(pick('PO-DO-JOB NO.')),driver_name:text(pick('DRIVER NAME-MOBILE','Driver')),owner_name:text(pick('OWNER')),from_location:text(pick('FROM')),to_location:text(pick('TO'))};
  if(!/^(cash|credit)$/i.test(sale)||!reference||!row.invoice_date||!row.customer||!row.vehicle_no||row.amount<=0)throw new Error(`Row ${index+2}: Reference, Invoice / Bill Date, Customer, Vehicle, positive Amount and Cash/Credit are required.`);
  if(row.sale_type==='Credit'&&!invoice)throw new Error(`Row ${index+2}: Credit invoice number is required.`);
  if((row.sale_type==='Cash'&&row.tax_percent!==0)||(row.sale_type==='Credit'&&row.tax_percent<=0)||row.tax_percent>100)throw new Error(`Row ${index+2}: Cash requires zero VAT; Credit requires a positive VAT rate.`);
  if(Math.abs(Math.round(row.amount*row.tax_percent)/100-row.tax_amount)>0.001||Math.abs(row.amount+row.tax_amount-row.bill_amount)>0.001)throw new Error(`Row ${index+2}: Amount, VAT and Bill Amount do not reconcile.`);
  const ref=reference.toLowerCase();if(references.has(ref))throw new Error(`Row ${index+2}: duplicate source reference ${reference}.`);references.add(ref);return row;
 });
 const invoices=new Map<string,ExternalInvoiceRow>();
 for(const row of rows){const group=row.invoice_no.toLowerCase()||`cash:${row.source_reference.toLowerCase()}`;const prior=invoices.get(group);if(prior&&(prior.customer.toLowerCase()!==row.customer.toLowerCase()||prior.invoice_date!==row.invoice_date||prior.sale_type!==row.sale_type||prior.tax_percent!==row.tax_percent))throw new Error(`Invoice ${row.invoice_no}: all lines must use the same Customer, Invoice Date, Cash/Credit and VAT rate.`);invoices.set(group,row);}
 return rows;
}
