import {useEffect,useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import NaviloDateInput from '@/components/NaviloDateInput';
import NaviloSearchableSelect from '@/components/SearchableSelect';

type Side='customer'|'supplier';
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
 const [party,setParty]=useState(''),[account,setAccount]=useState(''),[date,setDate]=useState(today());
 const [number,setNumber]=useState(''),[reference,setReference]=useState(''),[vatChoice,setVatChoice]=useState<'master'|'with_vat'|'without_vat'>('master'),[lines,setLines]=useState<Line[]>([empty()]);
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[done,setDone]=useState<{document_id:string;invoice_no:string;status:string;gross:number}|null>(null);
 const [loadedScope,setLoadedScope]=useState('');
 const [vehicles,setVehicles]=useState<{id:string;vehicle_no:string;revenue_account_id:string|null}[]>([]);
 const [ownership,setOwnership]=useState<{vehicle_id:string;owner_type:string;effective_from:string;effective_to:string|null}[]>([]);
 useEffect(()=>{
  let live=true;setVehicles([]);setOwnership([]);setLines([empty()]);
  if(!company||!bu)return;
  void (async()=>{
   const v:typeof vehicles=[];const o:typeof ownership=[];
   for(let offset=0;;offset+=500){const r=await supabase.from('transport_vehicles').select('id,vehicle_no,revenue_account_id').eq('company_id',company).eq('business_unit_id',bu).eq('is_active',true).order('id').range(offset,offset+499);if(r.error)throw r.error;v.push(...r.data??[]);if((r.data??[]).length<500)break;}
   for(let offset=0;;offset+=500){const r=await supabase.from('transport_vehicle_ownership').select('vehicle_id,owner_type,effective_from,effective_to').eq('company_id',company).eq('business_unit_id',bu).order('id').range(offset,offset+499);if(r.error)throw r.error;o.push(...r.data??[]);if((r.data??[]).length<500)break;}
   if(live){setVehicles(v);setOwnership(o);}
  })().catch(e=>{if(live)setError(e.message||'Vehicle Master unavailable');});return()=>{live=false};
 },[company,bu]);
 const eligibleVehicles=vehicles.filter(v=>ownership.some(o=>o.vehicle_id===v.id&&o.owner_type==='company'&&o.effective_from<=date&&(!o.effective_to||o.effective_to>=date)));

 useEffect(()=>{
  let cancelled=false;setParty('');setAccount('');setParties([]);setAccounts([]);setError('');setDone(null);setLoadedScope('');setLoading(true);
  if(!company||!bu){setError('Select an active Transport workspace.');setLoading(false);return;}
  const table=side==='customer'?'customers':'suppliers';
  const accountType=side==='customer'?'revenue':'expense';
  const mapping=side==='customer'?'sales_revenue':'cogs';
  void Promise.all([
   supabase.from(table).select('id,name').eq('company_id',company).eq('is_active',true).order('name'),
   supabase.from('chart_of_accounts').select('id,code,name').eq('company_id',company).eq('type',accountType).eq('is_active',true).eq('is_group',false).order('name'),
   supabase.from('account_mappings').select('account_id').eq('company_id',company).eq('mapping_key',mapping).limit(1).maybeSingle(),
  ]).then(([people,coa,m])=>{
   if(cancelled)return;
   if(people.error)throw people.error;if(coa.error)throw coa.error;if(m.error)throw m.error;
   const options=coa.data??[];
   setParties(people.data??[]);setAccounts(options);
   const mapped=m.data?.account_id;
   setAccount(mapped&&options.some(a=>a.id===mapped)?mapped:'');
   setLoadedScope(scope);
  }).catch(e=>{if(!cancelled)setError(e.message||'Unable to load active master data.')})
    .finally(()=>{if(!cancelled)setLoading(false)});
  return()=>{cancelled=true};
 },[company,bu,scope,side]);
 const amount=useMemo(()=>lines.reduce((total,l)=>total+(Number(l.amount)||0),0),[lines]);
 const lineError=validateNormalInvoiceLines(lines)
  ||(lines.some(l=>l.vehicle_id&&!eligibleVehicles.some(v=>v.id===l.vehicle_id))?'Select a company-owned vehicle valid on invoice date.':null);
 const available=loadedScope===scope&&!loading&&!saving&&!done&&Boolean(party&&account&&date)&&!lineError;
 const update=(index:number,k:keyof Line,value:string)=>setLines(old=>old.map((line,i)=>i===index?{...line,[k]:value}:line));
 async function save(post:boolean){
  if(!available)return;setSaving(true);setError('');
  try{
   const result=await supabase.rpc('transport_normal_invoice_create_vat',{ 
    p_side:side,p_party:party,p_date:date,
    p_lines:lines.map(l=>({description:l.description.trim(),amount:l.amount.trim(),...(l.vehicle_id?{vehicle_id:l.vehicle_id}:{})})),
    p_account:account,p_invoice_no:number.trim()||null,p_reference:reference.trim()||null,p_post:post,p_vat_choice:vatChoice,
   });
   if(result.error)throw result.error;
   setDone(result.data as {document_id:string;invoice_no:string;status:string;gross:number});
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
    <p>Total: SAR {money(Number(done.gross))}. Posted invoices update {side==='customer'?'receivables':'payables'}, VAT and ledgers. Payments are recorded separately.</p>
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
    <label className="navilo-invoice-field navilo-invoice-field-primary">{partyName} *
     <NaviloSearchableSelect nativeCompatibility preserveLabel aria-label={side==='customer'?'Normal invoice customer':'Normal invoice supplier'} className="input" value={party} onChange={e=>setParty(e.target.value)}>
      <option value="">Select {partyName}</option>{parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
     </NaviloSearchableSelect>
    </label>
    <label className="navilo-invoice-field">Invoice Date *<NaviloDateInput type="date" className="input" value={date} onChange={e=>setDate(e.target.value)}/></label>
    <label className="navilo-invoice-field">Original Invoice Number
     <input className="input" maxLength={80} aria-label="Normal invoice number" value={number} onChange={e=>setNumber(e.target.value)} placeholder={side==='customer'?'Customer invoice number':'Supplier invoice number'}/>
    </label>
    <label className="navilo-invoice-field">Reference / PO Number
     <input className="input" value={reference} maxLength={120} onChange={e=>setReference(e.target.value)} placeholder="Optional reference"/>
    </label>
    <label className="navilo-invoice-field">VAT Treatment
     <NaviloSearchableSelect nativeCompatibility aria-label="Normal invoice VAT treatment" className="input" value={vatChoice} onChange={e=>setVatChoice(e.target.value as 'master'|'with_vat'|'without_vat')}>
      <option value="master">Auto (Master Cash/Credit)</option><option value="with_vat">With VAT</option><option value="without_vat">Without VAT</option>
     </NaviloSearchableSelect>
    </label>
    <label className="navilo-invoice-field navilo-invoice-field-wide">{side==='customer'?'Sales Revenue Account':'Purchase / Expense Account'} *
     <NaviloSearchableSelect nativeCompatibility preserveLabel aria-label="Normal invoice ledger account" className="input" value={account} onChange={e=>setAccount(e.target.value)}>
      <option value="">Select active company account</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
     </NaviloSearchableSelect>
    </label>
   </fieldset>
  </section>

  <section className="navilo-invoice-card" aria-labelledby="normal-invoice-lines">
   <div className="navilo-invoice-card-heading navilo-invoice-line-heading">
    <div><span className="navilo-invoice-step">02</span><h2 id="normal-invoice-lines">Invoice Lines</h2><p>Description, optional company vehicle and net amount (SAR).</p></div>
    <button type="button" disabled={saving||!!done||lines.length>=50} className="btn-secondary" onClick={()=>setLines(v=>[...v,empty()])}>+ Description Line</button>
   </div>
   <div className="navilo-invoice-lines-wrap">
    <div className="navilo-invoice-line-grid navilo-invoice-line-columns" aria-hidden="true"><span>Description</span><span>Vehicle / Allocation</span><span className="navilo-align-right">Net Amount (SAR)</span><span/></div>
    {lines.map((line,i)=><div key={i} className="navilo-invoice-line-grid navilo-invoice-line-row">
     <label className="navilo-invoice-line-field"><span className="navilo-mobile-label">Description {i+1}</span>
      <input aria-label={`Description ${i+1}`} className="input" placeholder="Enter goods or service description" value={line.description} maxLength={1000} disabled={saving||!!done} onChange={e=>update(i,'description',e.target.value)}/>
     </label>
     <label className="navilo-invoice-line-field"><span className="navilo-mobile-label">Vehicle</span>
      <NaviloSearchableSelect nativeCompatibility aria-label={`Vehicle ${i+1}`} className="input" value={line.vehicle_id??''} disabled={saving||!!done} onChange={e=>update(i,'vehicle_id',e.target.value)}><option value="">General / Shared</option>{eligibleVehicles.map(v=><option key={v.id} value={v.id}>{v.vehicle_no}</option>)}</NaviloSearchableSelect>
     </label>
     <label className="navilo-invoice-line-field"><span className="navilo-mobile-label">Net Amount (SAR)</span>
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
    <p>Verify the {partyName.toLowerCase()}, original invoice number, description lines and VAT treatment before posting.</p>
    <p className="navilo-invoice-small-note">VAT is calculated using the effective applicable rate and master billing rules by the posting engine. A draft does not post accounting entries.</p>
    {side==='customer'&&<p className="navilo-invoice-small-note">Vehicle allocation is selected on each line and reported through <Link to="/master-data/vehicles">Vehicle Master</Link>; no duplicate journal is created.</p>}
    {lineError&&<p role="status" className="navilo-invoice-inline-warning">{lineError}</p>}
   </div>
   <div className="navilo-invoice-summary">
    <div className="navilo-invoice-summary-row"><span>Net amount</span><strong>SAR {money(amount)}</strong></div>
    <div className="navilo-invoice-summary-row"><span>VAT treatment</span><strong>{vatChoice==='with_vat'?'With VAT':vatChoice==='without_vat'?'Without VAT':'Master rule'}</strong></div>
    <div className="navilo-invoice-summary-hint">Final VAT and gross total are confirmed on the saved invoice.</div>
    <div className="navilo-invoice-summary-total"><span>Net before VAT</span><strong>SAR {money(amount)}</strong></div>
   </div>
   <div className="navilo-invoice-review-actions">
    <Link className="btn-secondary" to={side==='customer'?'/sales':'/purchase'}>Cancel</Link>
    <button type="button" className="btn-secondary" disabled={!available} onClick={()=>void save(false)}>{saving?'Saving…':'Save Draft'}</button>
    <button type="button" className="btn-primary" disabled={!available} onClick={()=>void save(true)}>{saving?'Posting…':`Post ${sideName} Invoice`}</button>
   </div>
  </section>
 </main>;
}
