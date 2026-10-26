import {useEffect,useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import NaviloDateInput from '@/components/NaviloDateInput';
import NaviloSearchableSelect from '@/components/SearchableSelect';
import QuickMasterAdd from '@/components/QuickMasterAdd';
import {useNormalInvoiceVatQuote} from './useNormalInvoiceVatQuote';

type Side='customer'|'supplier';
type DuplicateMatch={company:string;trips:string[];date:string;status:string};
type Party={id:string;name:string};
type Account={id:string;name:string;code?:string};
type Line={description:string;amount:string;vehicle_id?:string};
const empty=():Line=>({description:'',amount:''});
const today=()=>new Date().toISOString().slice(0,10);

export function validateNormalInvoiceLines(lines:Line[]):string|null{
 if(!lines.length||lines.length>50)return 'Enter 1–50 description lines.';
 for(const [index,line] of lines.entries()){
  if(!line.description.trim()||line.description.length>1000)return `Line ${index+1}: enter a description (up to 1,000 characters).`;
  if(!/^[0-9]{1,12}(\.[0-9]{1,2})?$/.test(line.amount.trim())||Number(line.amount)<=0)
   return `Line ${index+1}: enter a positive amount with at most 2 decimals.`;
 }
 return null;
}

export default function TransportNormalInvoiceCreate({side}:{side:Side}){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const company=activeCompany?.company_id,bu=activeBusinessUnit?.business_unit_id,scope=`${company}/${bu}`;
 const [parties,setParties]=useState<Party[]>([]),[accounts,setAccounts]=useState<Account[]>([]);
 const [serviceRevenueId,setServiceRevenueId]=useState('');
 const [party,setParty]=useState(''),[account,setAccount]=useState(''),[date,setDate]=useState(today());
 const [number,setNumber]=useState(''),[reference,setReference]=useState(''),[vatChoice,setVatChoice]=useState<'master'|'with_vat'|'without_vat'>('master'),[lines,setLines]=useState<Line[]>([empty()]);
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[done,setDone]=useState<{document_id:string;invoice_no:string;status:string;gross:number;net?:number;vat?:number}|null>(null);
 const [loadedScope,setLoadedScope]=useState('');
 const [duplicateAllowed,setDuplicateAllowed]=useState(false),[duplicateConflicts,setDuplicateConflicts]=useState<DuplicateMatch[]>([]),[duplicateConfirmed,setDuplicateConfirmed]=useState(false),[conflictLoading,setConflictLoading]=useState(false),[conflictError,setConflictError]=useState('');
 const [vehicles,setVehicles]=useState<{id:string;vehicle_no:string;ownership_type:string|null;revenue_account_id:string|null}[]>([]);
 const [ownership,setOwnership]=useState<{vehicle_id:string;owner_type:string;effective_from:string;effective_to:string|null}[]>([]);
 useEffect(()=>{
  let live=true;setVehicles([]);setOwnership([]);setLines([empty()]);
  if(!company||!bu)return;
  void (async()=>{
   const v:typeof vehicles=[];const o:typeof ownership=[];
   for(let offset=0;;offset+=500){const r=await supabase.from('transport_vehicles').select('id,vehicle_no,ownership_type,revenue_account_id').eq('company_id',company).eq('business_unit_id',bu).eq('is_active',true).order('id').range(offset,offset+499);if(r.error)throw r.error;v.push(...r.data??[]);if((r.data??[]).length<500)break;}
   for(let offset=0;;offset+=500){const r=await supabase.from('transport_vehicle_ownership').select('vehicle_id,owner_type,effective_from,effective_to').eq('company_id',company).eq('business_unit_id',bu).order('id').range(offset,offset+499);if(r.error)throw r.error;o.push(...r.data??[]);if((r.data??[]).length<500)break;}
   if(live){setVehicles(v);setOwnership(o);}
  })().catch(e=>{if(live)setError(e.message||'Vehicle Master unavailable');});return()=>{live=false};
 },[company,bu]);
 const refreshVehicles=async()=>{
  if(!company||!bu)throw Error("Select an active company.");
  const v:typeof vehicles=[],o:typeof ownership=[];
  for(let offset=0;;offset+=500){const r=await supabase.from("transport_vehicles").select("id,vehicle_no,ownership_type,revenue_account_id").eq("company_id",company).eq("business_unit_id",bu).eq("is_active",true).order("id").range(offset,offset+499);if(r.error)throw r.error;v.push(...r.data??[]);if((r.data??[]).length<500)break}
  for(let offset=0;;offset+=500){const r=await supabase.from("transport_vehicle_ownership").select("vehicle_id,owner_type,effective_from,effective_to").eq("company_id",company).eq("business_unit_id",bu).order("id").range(offset,offset+499);if(r.error)throw r.error;o.push(...r.data??[]);if((r.data??[]).length<500)break}
  setVehicles(v);setOwnership(o);return {vehicles:v,ownership:o};
 };
 const refreshAccounts=async()=>{
  if(!company)return;
  const r=await supabase.from("chart_of_accounts").select("id,code,name").eq("company_id",company).eq("type","expense").eq("is_active",true).eq("is_group",false).order("name");
  if(r.error)throw r.error;
  if(side==="supplier")setAccounts(r.data??[]);
 };
 const eligibleVehicles=vehicles.filter(v=>{
  const history=ownership.filter(o=>o.vehicle_id===v.id);
  // Only fall back to an explicitly company-owned Master when no history exists.
  return history.length
    ? history.some(o=>o.owner_type==='company'&&o.effective_from<=date&&(!o.effective_to||o.effective_to>=date))
    : v.ownership_type==='company';
 });

 useEffect(()=>{
  let cancelled=false;setParty('');setAccount('');setParties([]);setAccounts([]);setServiceRevenueId('');setError('');setDone(null);setLoadedScope('');setLoading(true);
  if(!company||!bu){setError('Select an active Transport workspace.');setLoading(false);return;}
  const table=side==='customer'?'customers':'suppliers';
  const accountType=side==='customer'?'revenue':'expense';
  const mapping=side==='customer'?'sales_revenue':'cogs';
  void Promise.all([
   supabase.from(table).select('id,name').eq('company_id',company).eq('is_active',true).order('name'),
   supabase.from('chart_of_accounts').select('id,code,name').eq('company_id',company).eq('type',accountType).eq('is_active',true).eq('is_group',false).order('name'),
   supabase.from('account_mappings').select('account_id').eq('company_id',company).eq('mapping_key',mapping).limit(1).maybeSingle(),
   ...(side==='customer'?[supabase.from('account_mappings').select('account_id').eq('company_id',company).eq('mapping_key','service_revenue').limit(1).maybeSingle()]:[]),
   supabase.rpc('transport_invoice_duplicate_override_allowed',{p_side:side}),
  ]).then(([people,coa,m,service,duplicatePermission])=>{
   if(cancelled)return;
   if(people.error)throw people.error;if(coa.error)throw coa.error;if(m.error)throw m.error;
   if(service?.error)throw service.error;
   if(duplicatePermission.error)throw duplicatePermission.error;
   setDuplicateAllowed(duplicatePermission.data===true);
   const serviceAccount=side==='customer'?service?.data?.account_id??'':'';
   const mapped=m.data?.account_id??'';
   if(side==='customer'&&(!mapped||mapped===serviceAccount||!(coa.data??[]).some(a=>a.id===mapped)))
    throw new Error('Normal Sales require a distinct active Sales Revenue account mapping.');
   const options=(coa.data??[]).filter(a=>side!=='customer'||a.id===mapped);
   setServiceRevenueId(serviceAccount);
   setParties(people.data??[]);setAccounts(options);
   setAccount(mapped&&options.some(a=>a.id===mapped)?mapped:'');
   setLoadedScope(scope);
  }).catch(e=>{if(!cancelled)setError(e.message||'Unable to load active master data.')})
    .finally(()=>{if(!cancelled)setLoading(false)});
  return()=>{cancelled=true};
 },[company,bu,scope,side]);
 useEffect(()=>{
  let live=true;const value=number.trim();setDuplicateConfirmed(false);setDuplicateConflicts([]);setConflictError('');
  if(!value||loadedScope!==scope)return;
  const timer=window.setTimeout(async()=>{
   setConflictLoading(true);
   try{const r=await supabase.rpc('transport_invoice_number_conflicts',{p_side:side,p_number:value});if(r.error)throw r.error;
    if(live)setDuplicateConflicts((r.data?.matches??[]) as DuplicateMatch[]);
   }catch(e:any){if(live)setConflictError(e?.message||'Could not check whether this invoice number is already used.');}
   finally{if(live)setConflictLoading(false);}
  },300);
  return()=>{live=false;window.clearTimeout(timer)};
 },[number,side,loadedScope,scope]);
 const amount=useMemo(()=>lines.reduce((total,l)=>total+(Number(l.amount)||0),0),[lines]);
 const amounts=useMemo(()=>lines.map(l=>Number(l.amount)||0),[lines]);
 const vatQuote=useNormalInvoiceVatQuote({company,bu,side,party,date,choice:vatChoice,amounts});
 const needsOriginalInvoice=side==='supplier'||(side==='customer'&&vatQuote.mode==='Credit');
 const originalNumberError=needsOriginalInvoice&&(
    !number.trim()||/^H-S-/i.test(number.trim())||/^(YES|CLEARED|NO INVOICE|BAD DEBTS|PENDING)$/i.test(number.trim())
  )?(side==='supplier'?'Supplier Purchase requires a genuine original invoice number before saving or posting.':'Credit Sales requires a genuine original invoice number (also for drafts).'):null;
 const lineError=validateNormalInvoiceLines(lines)
  ||(side==='customer'&&lines.some(l=>!l.vehicle_id)?'Select a company-owned vehicle for every Normal Sale invoice line.':null)
  ||(lines.some(l=>l.vehicle_id&&!eligibleVehicles.some(v=>v.id===l.vehicle_id))?'Select a company-owned vehicle valid on invoice date.':null);
 const available=loadedScope===scope&&!loading&&!saving&&!done&&Boolean(party&&account&&date)&&!lineError&&vatQuote.ready
  &&(side!=='customer'||account!==serviceRevenueId)&&!originalNumberError&&!conflictLoading&&!conflictError
  &&(!duplicateConflicts.length||(duplicateAllowed&&duplicateConfirmed));
 // Supplier original references are required even for new drafts: the backend must never
 // substitute a generated internal number for the actual supplier invoice number.
 const update=(index:number,k:keyof Line,value:string)=>setLines(old=>old.map((line,i)=>i===index?{...line,[k]:value}:line));
 async function saveDraft(){
  if(!available)return;setSaving(true);setError('');
  try{
   const result=await supabase.rpc('transport_normal_invoice_create_vat_with_override',{ 
    p_side:side,p_party:party,p_date:date,
    p_lines:lines.map(l=>({description:l.description.trim(),amount:l.amount.trim(),...(l.vehicle_id?{vehicle_id:l.vehicle_id}:{})})),
    p_account:account,p_invoice_no:number.trim()||null,
    // The supplier's actual invoice number belongs in supplier_invoice_no (p_reference),
    // not just NAVILO's purchase order_no. Never overwrite trip-linked supplier invoices.
    p_reference:side==='supplier'?number.trim()||null:reference.trim()||null,
    p_post:false,p_vat_choice:vatChoice,
    p_allow_duplicate_invoice:duplicateConflicts.length>0&&duplicateAllowed&&duplicateConfirmed,
   });
   if(result.error)throw result.error;
   setDone(result.data as {document_id:string;invoice_no:string;status:string;gross:number;net?:number;vat?:number});
  }catch(e:any){setError(e?.message||'Unable to create invoice. No Trip was modified.')}
  finally{setSaving(false)}
 }
 const sideName=side==='customer'?'Sale':'Purchase';
 const partyName=side==='customer'?'Customer':'Supplier';
 const money=(value:number)=>value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
 const invoiceImportLink='/workspace/imports';
 return <main className="navilo-invoice-editor navilo-invoice-pro navilo-transport-invoice" data-navilo-invoice-side={side} data-navilo-document-editor="true" aria-label={`${sideName} Invoice`}>
  <header className="navilo-invoice-hero">
   <div className="navilo-invoice-hero-main">
    <Link to={side==='customer'?'/sales':'/purchase'} className="navilo-invoice-breadcrumb">← {sideName} Invoices</Link>
    <div className="navilo-invoice-eyebrow">NEW DOCUMENT <span aria-hidden="true">/</span> NON-TRIP INVOICE</div>
    <h1>New {sideName} Invoice</h1>
    <p>Record a standalone {sideName.toLowerCase()} invoice from the {partyName} Master. No Trip or inventory movement.</p>
   </div>
   <div className="navilo-invoice-hero-actions">
    <span className="navilo-invoice-status">Draft</span>
    <Link className="btn-secondary" to={invoiceImportLink}>Import Center</Link>
   </div>
  </header>

  {loading&&<p role="status" className="navilo-invoice-notice">Loading {sideName} masters…</p>}
  {error&&<p role="alert" className="navilo-invoice-notice navilo-invoice-error">{error}</p>}
  {done&&<section role="status" className="navilo-invoice-card navilo-invoice-success">
    <h2>{sideName} invoice {done.status}: {done.invoice_no}</h2>
    <p>Net: SAR {money(Number(done.net??0))} · VAT: SAR {money(Number(done.vat??0))} · Total: SAR {money(Number(done.gross))}. This invoice is a draft; no accounting is posted yet. Review, edit and post it manually from the invoice detail screen.</p>
    <div className="navilo-invoice-button-row">
     <Link to={`/${side==='customer'?'sales':'purchase'}/${done.document_id}`} className="btn-secondary">View Invoice</Link>
     <button type="button" className="btn-primary" onClick={()=>{setDone(null);setParty('');setNumber('');setReference('');setVatChoice('master');setLines([empty()]);}}>Create Another</button>
    </div>
   </section>}

  <section className="navilo-invoice-card" aria-labelledby="normal-invoice-details">
   <div className="navilo-invoice-card-heading">
    <div><span className="navilo-invoice-step">01</span><h2 id="normal-invoice-details">{partyName} & Invoice Details</h2><p>Party, original document reference and VAT treatment.</p></div>
   </div>
   <fieldset disabled={loading||saving||!!done||loadedScope!==scope} className="navilo-invoice-detail-grid">
    <div className="navilo-invoice-field navilo-invoice-field-primary"><label className="block">{partyName} *
     <NaviloSearchableSelect nativeCompatibility preserveLabel aria-label={side==='customer'?'Normal invoice customer':'Normal invoice supplier'} className="input" value={party} onChange={e=>setParty(e.target.value)}>
      <option value="">Select {partyName}</option>{parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
     </NaviloSearchableSelect>
    </label>
      <QuickMasterAdd kind={side==="customer"?"customer":"supplier"} compact disabled={saving||!!done}
        onCreated={async created=>{setParties(old=>old.some(r=>r.id===created.id)?old:[...old,created]);setParty(created.id)}}/></div>
    <label className="navilo-invoice-field">Invoice Date *<NaviloDateInput type="date" className="input" value={date} onChange={e=>setDate(e.target.value)}/></label>
    <label className="navilo-invoice-field">{side==='supplier'?'Original Supplier Invoice Number': 'Original Invoice Number'}{needsOriginalInvoice?" *":""}
     <input className="input" maxLength={80} aria-label="Normal invoice number" required={needsOriginalInvoice} aria-invalid={Boolean(originalNumberError)} value={number} onChange={e=>setNumber(e.target.value)} placeholder={side==='customer'?'Customer invoice number':'Supplier invoice number'}/>
     {conflictLoading&&<span className="navilo-invoice-small-note">Checking invoice number…</span>}
     {conflictError&&<span role="alert" className="navilo-invoice-small-note text-red-700">{conflictError}</span>}
     {duplicateConflicts.length>0&&<div role="status" className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
      <strong>This number is already used in an accessible company:</strong>
      <ul className="mt-1 list-inside list-disc">{duplicateConflicts.map((hit,i)=><li key={hit.company+'-'+hit.date+'-'+i}>{hit.company} · {hit.date} · {hit.status} · {hit.trips?.length?'Trip '+hit.trips.join(', '):'no linked trip'}</li>)}</ul>
      {duplicateAllowed?<label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={duplicateConfirmed} onChange={e=>setDuplicateConfirmed(e.target.checked)}/><span>I have permission to save this duplicate invoice number.</span></label>:<p className="mt-2 font-semibold">Only a company owner, admin, or user with duplicate-invoice permission can continue.</p>}
     </div>}
    </label>
    {side==='customer'&&<label className="navilo-invoice-field">Reference / PO Number
     <input className="input" value={reference} maxLength={120} onChange={e=>setReference(e.target.value)} placeholder="Optional reference"/>
    </label>}
    <label className="navilo-invoice-field">VAT Treatment
     <NaviloSearchableSelect nativeCompatibility aria-label="Normal invoice VAT treatment" className="input" value={vatChoice} onChange={e=>setVatChoice(e.target.value as 'master'|'with_vat'|'without_vat')}>
      <option value="master">Auto (Master Cash/Credit)</option><option value="with_vat">With VAT</option><option value="without_vat">Without VAT</option>
     </NaviloSearchableSelect>
     <span className="navilo-invoice-vat-master-note">Master billing: {party?vatQuote.mode??'Not configured':'Select a party'}{vatQuote.rate!==null?` · VAT ${vatQuote.rate}%`:''}</span>
    </label>
    <div className="navilo-invoice-field navilo-invoice-field-wide"><label className="block">{side==='customer'?'Revenue GL Account':'Purchase / Expense GL Account'} *
     <NaviloSearchableSelect nativeCompatibility preserveLabel aria-label="Normal invoice ledger account" className="input" value={account} onChange={e=>setAccount(e.target.value)}>
      <option value="">Select active company account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
     </NaviloSearchableSelect>
     <span className="navilo-invoice-ledger-note">{side==='customer'?'Normal Sale defaults to Sales Revenue. Trip-linked Service Revenue is selected only in Service Invoices; each Normal Sale line requires a company-owned Vehicle Master selection for vehicle-wise P&L.':'Costs post to this expense account. Optional vehicle selection tags the expense for vehicle-wise reports.'}</span>
    </label>
      {side==="supplier"&&<QuickMasterAdd kind="account" compact disabled={saving||!!done} onRefresh={refreshAccounts}/>} </div>
   </fieldset>
  </section>

  <section className="navilo-invoice-card" aria-labelledby="normal-invoice-lines">
   <div className="navilo-invoice-card-heading navilo-invoice-line-heading">
    <div><span className="navilo-invoice-step">02</span><h2 id="normal-invoice-lines">Invoice Lines</h2><p>{side==='customer'?'Select the company vehicle earning each Normal Sale line. Vehicle selection is required.':'Enter descriptions and amounts; vehicle allocation on Purchase is optional.'}</p></div>
    <button type="button" disabled={saving||!!done||lines.length>=50} className="btn-secondary" onClick={()=>setLines(v=>[...v,empty()])}>+ Description Line</button>
   </div>
   <div className="navilo-invoice-lines-wrap">
    {lines.map((line,i)=><div key={i} className="navilo-invoice-line-grid navilo-invoice-line-row">
     <label className="navilo-invoice-line-field"><span className="navilo-invoice-line-label">Description {i+1}</span>
      <input aria-label={`Description ${i+1}`} className="input" placeholder="Enter goods or service description" value={line.description} maxLength={1000} disabled={saving||!!done} onChange={e=>update(i,'description',e.target.value)}/>
     </label>
     <div className="navilo-invoice-line-field"><label className="block"><span className="navilo-invoice-line-label">Vehicle {side==='customer'?'*':'(optional)'}</span>
      <NaviloSearchableSelect nativeCompatibility aria-label={`Vehicle ${i+1}`} className="input" value={line.vehicle_id??''} required={side==='customer'} disabled={saving||!!done} onChange={e=>update(i,'vehicle_id',e.target.value)}><option value="">{side==='customer'?'Select company vehicle':'No vehicle'}</option>{eligibleVehicles.map(v=><option key={v.id} value={v.id}>{v.vehicle_no}</option>)}</NaviloSearchableSelect>
     </label>
      <QuickMasterAdd kind="vehicle" compact disabled={saving||!!done} onCreated={async created=>{
        const snapshot=await refreshVehicles();const v=snapshot.vehicles.find(r=>r.id===created.id);
        if(!v)throw Error("New vehicle is not visible in this company.");
        const h=snapshot.ownership.filter(r=>r.vehicle_id===v.id);
        const valid=h.length?h.some(r=>r.owner_type==="company"&&r.effective_from<=date&&(!r.effective_to||r.effective_to>=date)):v.ownership_type==="company";
        if(!valid)throw Error("Vehicle ownership must be company-owned and effective on invoice date.");
        update(i,"vehicle_id",created.id);
       }}/></div>
     <label className="navilo-invoice-line-field"><span className="navilo-invoice-line-label">Net Amount (SAR)</span>
      <input aria-label={`Amount ${i+1}`} className="input navilo-align-right" inputMode="decimal" placeholder="0.00" value={line.amount} disabled={saving||!!done} onChange={e=>update(i,'amount',e.target.value)}/>
     </label>
     <button type="button" aria-label={`Remove line ${i+1}`} title="Remove line" className="navilo-invoice-line-remove" disabled={saving||!!done||lines.length<=1} onClick={()=>setLines(v=>v.filter((_,index)=>index!==i))}>×</button>
    </div>)}
   </div>
   <div className="navilo-invoice-lines-footer">{lines.length} {lines.length===1?'line':'lines'} · Up to 50 description lines per invoice.</div>
  </section>

  <section className="navilo-invoice-card navilo-invoice-review" aria-labelledby="normal-invoice-review">
   <div className="navilo-invoice-review-help">
    <span className="navilo-invoice-step">03</span><h2 id="normal-invoice-review">Review & Save</h2>
    <p>Verify the {partyName.toLowerCase()}, original invoice number, description lines and VAT treatment before saving the draft.</p>
    <p className="navilo-invoice-small-note">VAT follows the party's Master Cash/Credit rule and the invoice-date effective tax rate. A draft does not post accounting entries.</p>
    {vatQuote.error&&<p role="alert" className="navilo-invoice-inline-warning">{vatQuote.error} <button type="button" className="underline font-semibold" onClick={()=>setVatChoice("master")}>Use Master VAT</button> <Link to={side==='customer'?'/master-data/customers?tab=billing':'/master-data/suppliers'}>Open Master</Link></p>}
    {originalNumberError&&<p role="status" className="navilo-invoice-inline-warning">{originalNumberError}</p>}
    {side==='supplier'&&!number.trim()&&<p className="navilo-invoice-small-note">Enter the supplier's original invoice number. This screen only saves a draft; posting happens later from invoice detail.</p>}
    {vatQuote.loading&&<p role="status" className="navilo-invoice-small-note">Loading VAT rate and Master billing mode…</p>}
    <p className="navilo-invoice-small-note">{side==='customer'?'Normal Sales revenue posts to the selected Sales Revenue GL; each line must be assigned to one company-owned vehicle for the vehicle-wise P&L. No Trip Register posting.':'A posted Purchase Invoice creates the expense, applicable input VAT and supplier payable once. Select the company-owned vehicle on each related cost line for vehicle-wise P&L; leave it blank only for genuinely general expenses. Pay the supplier separately. Do not also post a Journal Entry for the same bill.'}</p>
    {lineError&&<p role="status" className="navilo-invoice-inline-warning">{lineError}</p>}
   </div>
   <div className="navilo-invoice-summary">
    <div className="navilo-invoice-summary-row"><span>Net amount</span><strong>SAR {money(amount)}</strong></div>
    <div className="navilo-invoice-summary-row"><span>VAT treatment</span><strong>{vatChoice==='with_vat'?'With VAT':vatChoice==='without_vat'?'Without VAT':'Auto · Master rule'}</strong></div>
    <div className="navilo-invoice-summary-row"><span>VAT rate</span><strong>{vatQuote.rate!==null?`${vatQuote.rate}%`:'—'}</strong></div>
    <div className="navilo-invoice-summary-row"><span>VAT amount</span><strong>{vatQuote.preview?`SAR ${money(vatQuote.preview.vat)}`:'—'}</strong></div>
    <div className="navilo-invoice-summary-hint">{vatQuote.error||'Preview follows the party billing mode and tax rate effective on the invoice date. Posting is validated on the server.'}</div>
    <div className="navilo-invoice-summary-total"><span>Grand Total</span><strong>{vatQuote.preview?`SAR ${money(vatQuote.preview.gross)}`:'—'}</strong></div>
   </div>
   <div className="navilo-invoice-review-actions">
    <Link className="btn-secondary" to={side==='customer'?'/sales':'/purchase'}>Cancel</Link>
    <button type="button" className="btn-primary" disabled={!available} onClick={()=>void saveDraft()}>{saving?'Saving…':'Save Draft'}</button>
   </div>
  </section>
 </main>;
}
