import { useRef, useState } from 'react';
import { createQuickMaster, EMPTY_QUICK_MASTER, type QuickAddKind } from './transportTripEntry';
import useTransportMasterClient from '@/modules/master-data/useTransportMasterClient';

export default function TransportQuickAdd({kind,truckTypeId,supplierId,truckTypes,suppliers,onCreated,onClose}:{
  kind:QuickAddKind;truckTypeId:string;supplierId:string;truckTypes:any[];suppliers:any[];
  onCreated:(record:any)=>Promise<void>;onClose:()=>void;
}) {
  const client=useTransportMasterClient();
  const [form,setForm]=useState({...EMPTY_QUICK_MASTER,truck_type_id:truckTypeId,supplier_id:supplierId});
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const submitting=useRef(false);
  const createdRecord=useRef<any>(null);
  const title=kind==='customer'?'Customer':kind==='supplier'?'Owner / Supplier':kind==='driver'?'Driver':kind==='vehicle'?'Vehicle / Plate':kind==='truckType'?'Truck Type':'Location';
  function field(key:keyof typeof form,label:string,type='text',required=false) {return <label className="block text-xs font-semibold">{label}<input aria-label={label} required={required} type={type} className="input mt-1 w-full" value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>}
  async function save(e:React.FormEvent) {e.preventDefault();if(submitting.current)return;submitting.current=true;setBusy(true);setError('');
    try{const record=createdRecord.current??await createQuickMaster(client,kind,form);createdRecord.current=record;await onCreated(record);onClose();}
    catch(e:any){setError(e.message||'Unable to create master.');}finally{submitting.current=false;setBusy(false);}}
  const supplierRequired=kind==='vehicle'?form.ownership_type==='supplier':form.driver_type==='supplier';
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-3">
    <form role="dialog" aria-modal="true" aria-labelledby="quick-master-title" onSubmit={save} className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg bg-white shadow-xl">
      <div className="flex items-center justify-between border-b px-4 py-3"><h2 id="quick-master-title" className="text-sm font-bold">Add {title}</h2><button type="button" disabled={busy} aria-label="Close quick add" onClick={onClose}>×</button></div>
      <fieldset disabled={busy||Boolean(createdRecord.current)} className="grid gap-3 p-4 sm:grid-cols-2">
        {field('name',kind==='vehicle'?'Plate / Vehicle No':kind==='driver'?'Driver Name':'Name','text',true)}
        {kind==='vehicle'&&<label className="text-xs font-semibold">Truck Type<select aria-label="Truck Type" className="input mt-1 w-full" value={form.truck_type_id} onChange={e=>setForm({...form,truck_type_id:e.target.value})}><option value="">Select Truck Type</option>{truckTypes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
        {(kind==='vehicle'||kind==='driver')&&<label className="text-xs font-semibold">{kind==='vehicle'?'Ownership Type':'Driver Type'}<select aria-label={kind==='vehicle'?'Ownership Type':'Driver Type'} className="input mt-1 w-full" value={kind==='vehicle'?form.ownership_type:form.driver_type} onChange={e=>setForm({...form,[kind==='vehicle'?'ownership_type':'driver_type']:e.target.value,supplier_id:''})}><option value="company">{kind==='vehicle'?'Company Owned':'Company Driver'}</option><option value="supplier">{kind==='vehicle'?'Supplier Owned':'Supplier Driver'}</option></select></label>}
        {(kind==='vehicle'||kind==='driver')&&supplierRequired&&<label className="text-xs font-semibold">Supplier<select aria-label="Supplier" required className="input mt-1 w-full" value={form.supplier_id} onChange={e=>setForm({...form,supplier_id:e.target.value})}><option value="">Select Supplier</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
        {kind==='vehicle'&&field('effective_from','Ownership Effective From','date',true)}
        {kind==='driver'&&<>{field('driver_code','Driver Code')}{field('mobile','Mobile')}{field('identity_no','ID / CNIC / Iqama')}{field('driving_licence_no','Driving Licence No')}{field('licence_expiry','Licence Expiry','date')}</>}
        {(kind==='customer'||kind==='supplier')&&<>{field('mobile','Phone')}{field('email','Email','email')}{field('address','Address')}</>}
        <p className="text-xs text-slate-600 sm:col-span-2">New master is active. {kind==='supplier'?'Creating a Supplier does not change vehicle ownership. Use Vehicle Ownership History for a dated change.':''}</p>
      </fieldset>
      {error&&<p role="alert" className="px-4 pb-3 text-xs text-red-700">{error}</p>}
      <div className="flex justify-end gap-2 border-t px-4 py-3"><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy}>{busy?'Saving...':'Save & Select'}</button></div>
    </form></div>;
}
