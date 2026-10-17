import {useRef,useState} from 'react';
import * as XLSX from 'xlsx';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import {downloadImportTemplate} from '@/lib/importExcelTemplate';
import {previewVehicleExpenseImport,type VehicleExpenseRow} from './vehicleExpenseImport';

/** Read-only import review until atomic VAT-aware posting is enabled. */
export default function TransportVehicleExpenseImportPreview(){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const picker=useRef<HTMLInputElement>(null);
 const [rows,setRows]=useState<VehicleExpenseRow[]>([]);
 const [error,setError]=useState('');
 const [filename,setFilename]=useState('');
 const download=()=>downloadImportTemplate({
  filename:'NAVILO-Transport-Vehicle-Expense-Template.xlsx',
  sheetName:'Vehicle Expenses',
  title:'Multi-vehicle expense upload — pre-posting review',
  headers:['Expense Group','Expense Date','Supplier or Payee','Expense Type','Description','Vehicle Number','Trip No (Optional)','Net Amount SAR','VAT Rate %','VAT Amount SAR','Gross Amount SAR','Payment Method','Source Reference'],
  example:['EXP-001','2026-10-17','Supplier A','Diesel','Diesel for vehicle 5731','5731','',800,0,0,800,'Bank','REF-001'],
  notes:['Review-only while VAT-aware accounting import is being implemented; this screen cannot post expenses.','Repeat Expense Group for lines of the same document. Vehicle Number is required; Trip No optional.','VAT Rate % must be 0 or 15 for template preview. The tax rate applicable on the expense date must be checked before posting.','Payment Method: Cash, Bank, Payable. Payable requires a Supplier.','Source Reference must be unique per line.']
 });
 async function choose(e:React.ChangeEvent<HTMLInputElement>){
  const f=e.target.files?.[0];e.target.value='';
  if(!f)return;
  setError('');setRows([]);setFilename('');
  try {
   if(f.size>5*1024*1024)throw Error('Maximum file size is 5 MB.');
   const wb=XLSX.read(await f.arrayBuffer(),{type:'array',cellDates:false});
   if(!wb.SheetNames.length)throw Error('Workbook is empty.');
   const values=XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets[wb.SheetNames[0]],{defval:''});
   const parsed=previewVehicleExpenseImport(values);
   const company=activeCompany?.company_id,unit=activeBusinessUnit?.business_unit_id;
   if(!company||!unit)throw Error('Select an active Transport company and business unit.');
   const uniqueVehicles=[...new Set(parsed.map(x=>x.vehicle_no))];
   const uniqueTypes=[...new Set(parsed.map(x=>x.expense_type))];
   const vehicles: Array<{vehicle_no:string}>=[];
   for(let i=0;i<uniqueVehicles.length;i+=100){
    const result=await supabase.from('transport_vehicles').select('vehicle_no')
     .eq('company_id',company).eq('business_unit_id',unit).eq('is_active',true)
     .in('vehicle_no',uniqueVehicles.slice(i,i+100));
    if(result.error)throw result.error;
    vehicles.push(...(result.data??[]));
   }
   const expenseTypes=await supabase.from('transport_vehicle_expense_types').select('name')
    .eq('company_id',company).eq('business_unit_id',unit).eq('is_active',true);
   if(expenseTypes.error)throw expenseTypes.error;
   const foundVehicles=new Set(vehicles.map(x=>x.vehicle_no.trim().toLowerCase()));
   const foundTypes=new Set((expenseTypes.data??[]).map(x=>x.name.trim().toLowerCase()));
   const missingVehicles=uniqueVehicles.filter(x=>!foundVehicles.has(x.toLowerCase()));
   const missingTypes=uniqueTypes.filter(x=>!foundTypes.has(x.toLowerCase()));
   if(missingVehicles.length)throw Error('Vehicles not found/active in selected business unit: '+missingVehicles.slice(0,8).join(', '));
   if(missingTypes.length)throw Error('Expense Types not found/active in selected business unit: '+missingTypes.slice(0,8).join(', '));
   const uniqueTrips=[...new Set(parsed.flatMap(x=>x.trip_no?[x.trip_no]:[]))];
   if(uniqueTrips.length){
    const matched=new Set<string>();
    for(let i=0;i<uniqueTrips.length;i+=100){
     const result=await supabase.from('transport_trips').select('trip_no')
      .eq('company_id',company).eq('business_unit_id',unit)
      .in('trip_no',uniqueTrips.slice(i,i+100));
     if(result.error)throw result.error;
     for(const trip of result.data??[])matched.add(trip.trip_no.trim().toLowerCase());
    }
    const missing=uniqueTrips.filter(x=>!matched.has(x.toLowerCase()));
    if(missing.length)throw Error('Trips not found in selected business unit: '+missing.slice(0,8).join(', '));
   }
   const payableNames=[...new Set(parsed.filter(x=>x.payment_method==='payable').map(x=>x.supplier_or_payee))];
   if(payableNames.length){
    const matched=new Set<string>();
    for(let i=0;i<payableNames.length;i+=100){
     const result=await supabase.from('suppliers').select('name')
      .eq('company_id',company).eq('is_active',true)
      .in('name',payableNames.slice(i,i+100));
     if(result.error)throw result.error;
     for(const supplier of result.data??[])matched.add(supplier.name.trim().toLowerCase());
    }
    const missing=payableNames.filter(x=>!matched.has(x.toLowerCase()));
    if(missing.length)throw Error('Payable suppliers not found in active company: '+missing.slice(0,8).join(', '));
   }
   setRows(parsed);setFilename(f.name);
  }catch(e){setError(e instanceof Error?e.message:'Invalid workbook.');}
 }
 const net=rows.reduce((n,r)=>n+Number(r.net_amount),0);
 const vat=rows.reduce((n,r)=>n+Number(r.vat_amount),0);
 return <section aria-label="Vehicle Expense Import Review" className="space-y-2 rounded border border-slate-200 p-3">
  <h3 className="text-sm font-bold">Multi-Vehicle Expenses — Excel Review</h3>
  <p className="text-xs text-amber-800">Preview only. Uploading here does not save or post an expense. Accounting posting and VAT verification are not yet enabled.</p>
  <div className="flex gap-2">
   <button type="button" className="btn" onClick={download}>Download Template</button>
   <button type="button" className="btn" onClick={()=>picker.current?.click()}>Choose Excel/CSV</button>
   <input ref={picker} type="file" accept=".xlsx,.xls,.csv" className="hidden" aria-label="Vehicle expense review file" onChange={e=>void choose(e)}/>
  </div>
  {error&&<p role="alert" className="text-xs text-red-700">{error}</p>}
  {filename&&<p className="text-xs">{filename} · {rows.length} lines · Net {net.toFixed(2)} SAR · VAT {vat.toFixed(2)} SAR · Gross {(net+vat).toFixed(2)} SAR</p>}
  {!!rows.length&&<div className="max-h-56 overflow-auto"><table className="w-full text-xs"><thead><tr>{['Group','Date','Vehicle','Trip','Expense','Net','VAT','Gross'].map(s=><th className="p-1 text-left" key={s}>{s}</th>)}</tr></thead>
   <tbody>{rows.map((r,i)=><tr className="border-t" key={i}><td>{r.expense_group}</td><td>{r.expense_date}</td><td>{r.vehicle_no}</td><td>{r.trip_no||'—'}</td><td>{r.expense_type}</td><td>{r.net_amount}</td><td>{r.vat_amount}</td><td>{r.gross_amount}</td></tr>)}</tbody>
   </table></div>}
 </section>;
}
