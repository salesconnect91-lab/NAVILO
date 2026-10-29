import {parseNaviloImportDate} from '@/lib/importExcelTemplate';
/** Validate workbook data before atomic server-side draft import. */
export type VehicleExpenseRow = {
  expense_group: string; expense_date: string; supplier_or_payee: string;
  expense_type: string; description: string; vehicle_no: string;
  trip_no: string | null; net_amount: string; vat_rate: number;
  vat_amount: string; gross_amount: string; payment_method: 'cash'|'bank'|'payable';
  source_reference: string; expense_account?:string;vat_recoverable?:boolean;
};
const norm=(s:unknown)=>String(s??'').trim();
const key=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
const pick=(row:Record<string,unknown>,name:string)=>Object.entries(row).find(([a])=>key(a)===key(name))?.[1];
const cents=(x:unknown,field:string,line:number)=>{
  const s=norm(x).replaceAll(',','');
  if(!/^\d{1,12}(\.\d{1,2})?$/.test(s))throw Error(`Row ${line}: invalid ${field}.`);
  const [whole,part='']=s.split('.');
  const n=Number(whole)*100+Number(part.padEnd(2,'0'));
  if(!Number.isSafeInteger(n))throw Error(`Row ${line}: ${field} out of range.`);
  return n;
};
const money=(n:number)=>(n/100).toFixed(2);
export function previewVehicleExpenseImport(raw:Record<string,unknown>[]):VehicleExpenseRow[] {
  if(raw.length<1||raw.length>500)throw Error('Upload 1–500 lines per batch.');
  const references=new Set<string>();
  const groups=new Map<string,string>();
  return raw.map((row,i)=>{
    const line=i+2;
    const get=(name:string)=>norm(pick(row,name));
    const expense_group=get('Expense Group');
    const expense_date=parseNaviloImportDate(pick(row,'Expense Date'));
    const supplier_or_payee=get('Supplier or Payee');
    const expense_type=get('Expense Type');
    const description=get('Description');
    const vehicle_no=get('Vehicle Number');
    const trip_no=get('Trip No (Optional)')||null;
    const source_reference=get('Source Reference');
    const method=get('Payment Method').toLowerCase();
    if(!expense_group||!expense_type||!description||!vehicle_no||!source_reference)throw Error(`Row ${line}: group, type, description, vehicle and source reference required.`);
    if(!expense_date)throw Error(`Row ${line}: date must be dd-mmm-yy, e.g. 15-Oct-26 (ISO and Excel dates are also accepted).`);
    if(!['cash','bank','payable'].includes(method))throw Error(`Row ${line}: payment method must be Cash, Bank or Payable.`);
    if(method==='payable'&&!supplier_or_payee)throw Error(`Row ${line}: Payable requires Supplier.`);
    const refKey=source_reference.toLowerCase();
    if(references.has(refKey))throw Error(`Row ${line}: repeated source reference ${source_reference}.`);
    references.add(refKey);
    const groupKey=expense_group.toLowerCase();
    const signature=JSON.stringify([expense_date,supplier_or_payee.toLowerCase(),method]);
    if(groups.has(groupKey)&&groups.get(groupKey)!==signature)throw Error(`Row ${line}: document header differs within Expense Group.`);
    groups.set(groupKey,signature);
    const net=cents(pick(row,'Net Amount SAR'),'net amount',line);
    if(net<=0)throw Error(`Row ${line}: net amount must be positive.`);
    const rateText=get('VAT Rate %');
    if(!/^\d{1,3}(\.\d{1,2})?$/.test(rateText)||Number(rateText)>100)throw Error(`Row ${line}: VAT rate must be between 0 and 100; effective tax rules validated by server.`);
    const rate=Number(rateText);
    const vat=Math.round(net*rate/100);
    const claimedVat=norm(pick(row,'VAT Amount SAR'));
    const claimedGross=norm(pick(row,'Gross Amount SAR'));
    if(claimedVat&&cents(claimedVat,'VAT amount',line)!==vat)throw Error(`Row ${line}: VAT amount mismatch.`);
    if(claimedGross&&cents(claimedGross,'Gross amount',line)!==net+vat)throw Error(`Row ${line}: gross amount mismatch.`);
    return {expense_group,expense_date,supplier_or_payee,expense_type,description,vehicle_no,trip_no,
      net_amount:money(net),vat_rate:rate,vat_amount:money(vat),gross_amount:money(net+vat),
      payment_method:method as VehicleExpenseRow['payment_method'],source_reference,expense_account:get('Expense Account (Optional)'),vat_recoverable:!['no','false','0'].includes(get('Recoverable VAT (Yes/No)').toLowerCase())};
  });
}
