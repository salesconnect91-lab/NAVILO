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
 const [saving,setSaving]=useState(false);
 const [savedMessage,setSavedMessage]=useState('');
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
  setError('');setRows([]);setFilename('');setSavedMessage('');
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
 async function saveSingleDraft(){
  if(saving||!rows.length)return;
  const groups=new Set(rows.map(r=>r.expense_group.toLowerCase()));
  if(groups.size!==1){setError('Draft saving supports one Expense Group per upload at present. Split the Excel into one file per document.');return;}
  const c=activeCompany?.company_id,b=activeBusinessUnit?.business_unit_id;
  if(!c||!b){setError('Select an active Transport company and business unit.');return;}
  const first=rows[0];
  setSaving(true);setError('');setSavedMessage('');
  try{
   const uniqueVehicles=[...new Set(rows.map(r=>r.vehicle_no))];
   const vehicles=await supabase.from('transport_vehicles').select('id,vehicle_no')
    .eq('company_id',c).eq('business_unit_id',b).eq('is_active',true).in('vehicle_no',uniqueVehicles);
   if(vehicles.error)throw vehicles.error;
   const vehicleMap=new Map((vehicles.data??[]).map(v=>[v.vehicle_no.trim().toLowerCase(),v.id]));
   if(vehicleMap.size!==uniqueVehicles.length)throw Error('Vehicle master changed since preview. Reload the file.');
   const uniqueTrips=[...new Set(rows.flatMap(r=>r.trip_no?[r.trip_no]:[]))];
   const tripMap=new Map<string,{id:string;vehicle_id:string|null}>();
   if(uniqueTrips.length){
    const trips=await supabase.from('transport_trips').select('id,trip_no,vehicle_id')
     .eq('company_id',c).eq('business_unit_id',b).in('trip_no',uniqueTrips);
    if(trips.error)throw trips.error;
    for(const t of trips.data??[])tripMap.set(t.trip_no.trim().toLowerCase(),{id:t.id,vehicle_id:t.vehicle_id});
   }
   const supplierNames=[...new Set(rows.filter(r=>r.payment_method==='payable').map(r=>r.supplier_or_payee.toLowerCase()))];
   let supplierId:string|null=null;
   if(supplierNames.length){
    if(supplierNames.length!==1)throw Error('One Payable document requires one Supplier.');
    const supplier=await supabase.from('suppliers').select('id,name').eq('company_id',c).eq('is_active',true);
    if(supplier.error)throw supplier.error;
    const matched=(supplier.data??[]).filter(x=>x.name.trim().toLowerCase()===supplierNames[0]);
    if(matched.length!==1)throw Error('Supplier must uniquely match one active Master.');
    supplierId=matched[0].id;
   }
   const lines=rows.map(r=>{
    const vehicle_id=vehicleMap.get(r.vehicle_no.toLowerCase());
    if(!vehicle_id)throw Error('Vehicle not found: '+r.vehicle_no);
    const trip=r.trip_no?tripMap.get(r.trip_no.toLowerCase()):null;
    if(r.trip_no&&(!trip||trip.vehicle_id!==vehicle_id))throw Error('Trip/vehicle mismatch: '+r.trip_no);
    return {vehicle_id,trip_id:trip?.id??null,expense_type:r.expense_type,description:r.description,
      net_amount:r.net_amount,vat_rate:r.vat_rate,source_reference:r.source_reference};
   });
   const result=await supabase.rpc('transport_save_vehicle_expense_draft',{
    p_group:first.expense_group,p_date:first.expense_date,p_supplier_id:supplierId,
    p_method:first.payment_method,p_lines:lines
   });
   if(result.error)throw result.error;
   setSavedMessage('Draft saved without accounting posting. Document ID: '+String(result.data?.document_id??''));
   setRows([]);setFilename('');
  }catch(e){setError(e instanceof Error?e.message:'Draft save failed. No confirmed save.');}
  finally{setSaving(false);}
 }
 const net=rows.reduce((n,r)=>n+Number(r.net_amount),0);
 const vat=rows.reduce((n,r)=>n+Number(r.vat_amount),0);
 return <section aria-label="Vehicle Expense Import Review" className="space-y-2 rounded border border-slate-200 p-3">
  <h3 className="text-sm font-bold">Multi-Vehicle Expenses — Excel Review</h3>
  <p className="text-xs text-amber-800">Preview and draft saving only. Save Draft requires the database migration; no VAT, GL or payable posting occurs.</p>
  <div className="flex gap-2">
   <button type="button" className="btn" onClick={download}>Download Template</button>
   <button type="button" className="btn" onClick={()=>picker.current?.click()}>Choose Excel/CSV</button>
   <input ref={picker} type="file" accept=".xlsx,.xls,.csv" className="hidden" aria-label="Vehicle expense review file" onChange={e=>void choose(e)}/>
  </div>
  {savedMessage&&<p role="status" className="text-xs text-emerald-700">{savedMessage}</p>}
  {error&&<p role="alert" className="text-xs text-red-700">{error}</p>}
  {filename&&<p className="text-xs">{filename} · {rows.length} lines · Net {net.toFixed(2)} SAR · VAT {vat.toFixed(2)} SAR · Gross {(net+vat).toFixed(2)} SAR</p>}
  {!!rows.length&&<button type="button" className="btn" disabled={saving} onClick={()=>void saveSingleDraft()}>{saving?'Saving…':'Save Single Expense Group as Draft (No Posting)'}</button>}
  {!!rows.length&&<div className="max-h-56 overflow-auto"><table className="w-full text-xs"><thead><tr>{['Group','Date','Vehicle','Trip','Expense','Net','VAT','Gross'].map(s=><th className="p-1 text-left" key={s}>{s}</th>)}</tr></thead>
   <tbody>{rows.map((r,i)=><tr className="border-t" key={i}><td>{r.expense_group}</td><td>{r.expense_date}</td><td>{r.vehicle_no}</td><td>{r.trip_no||'—'}</td><td>{r.expense_type}</td><td>{r.net_amount}</td><td>{r.vat_amount}</td><td>{r.gross_amount}</td></tr>)}</tbody>
   </table></div>}
 </section>;
}
