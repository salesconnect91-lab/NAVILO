import TransportDialog from './TransportDialog';
import NaviloSearchableSelect from "@/components/SearchableSelect";
import TransportVatPreview from './TransportVatPreview';
import NaviloDateInput from '@/components/NaviloDateInput';
import {useEffect,useRef,useState} from 'react';
import {useAuth} from '@/auth/AuthContext';
import {supabase} from '@/lib/supabase';
import {type FinancialTrip} from './transportFinancialTypes';

type InvoiceTrip=FinancialTrip & {invoice_no?:string|null;sales_order_id?:string|null;posted?:boolean};
type DuplicateMatch={company:string;trips:string[];date:string;status:string};

export function isValidTransportOriginalInvoice(value:string):boolean {
 const trimmed=value.trim();
 const upper=trimmed.toUpperCase();
 return Boolean(trimmed) && !upper.startsWith('H-S-')
  && !/^(?:YES|NO|CLEARED(?:\s+.*)?|CLERAED(?:\s+.*)?|NO\s+INVOICE|BAD\s+DEBTS?|PENDING|NOT\s+INVOICED|ADJUSTED\s+WITH\s+.*|INVOICE\s+ADJUSTED|CA|CRN|N\/A|0)$/i.test(trimmed);
}

export function invoicePostingBlockers(input:{
 posted:boolean;loading:boolean;allowed:boolean;rateReady:boolean;mode:'choose'|'auto'|'manual';
 number:string;date:string;account:string;vatReady:boolean;withTax:boolean;validSaleType:boolean;
}):string[]{
 if(input.posted)return [];
 const reasons:string[]=[];
 if(input.loading)reasons.push('Checking Transport billing permission and company Revenue Accounts…');
 else if(!input.allowed)reasons.push('Draft invoice creation permission is not enabled for this Transport workspace.');
 if(!input.validSaleType)reasons.push('Customer Cash/Credit billing mode is missing. Configure the Customer Master.');
 if(!input.rateReady)reasons.push('Finalize a positive Company Rate before posting.');
 if(input.mode==='choose')reasons.push('Choose how to number this invoice.');
 else if(input.mode==='auto'&&input.withTax)reasons.push('Credit Sales require the original invoice number, not an automatically generated number.');
 else if(input.mode==='manual'&&!isValidTransportOriginalInvoice(input.number))
  reasons.push('Enter a genuine original invoice number (not H-S, YES or a settlement remark).');
 if(!input.date)reasons.push('Choose an invoice date.');
 if(!input.account&&!input.loading)reasons.push('Choose an active Revenue Account belonging to this company.');
 if(input.withTax&&!input.vatReady)reasons.push('Effective Sales VAT is unavailable for this invoice date. Configure it in Tax before posting.');
 return reasons;
}

export default function TransportInvoiceNumber({trip,onClose,onChanged}:{trip:InvoiceTrip;onClose:()=>void;onChanged:()=>Promise<void>}){
 const {activeCompany,activeBusinessUnit}=useAuth();
 const companyId=activeCompany?.company_id;
 const businessUnitId=activeBusinessUnit?.business_unit_id;
 const scope=`${companyId??''}/${businessUnitId??''}`;
 const posted=typeof trip.posted==='boolean'?trip.posted:Boolean(trip.invoiced||trip.sales_order_id||Number(trip.billed_customer_net??0)>0);
 const [invoiceNo,setInvoiceNo]=useState(trip.invoice_no??'');
 const [numberMode,setNumberMode]=useState<'choose'|'auto'|'manual'>(()=>String(trip.sale_type??'').toLowerCase()==='credit'?'manual':'auto');
 const [date,setDate]=useState(new Date().toISOString().slice(0,10));
 const saleType=String(trip.sale_type??'').toLowerCase();
 const withTax=saleType==='credit';const [vatReady,setVatReady]=useState(!withTax);
 const [allowed,setAllowed]=useState(false);const [postAllowed,setPostAllowed]=useState(false);const [accounts,setAccounts]=useState<{id:string;name:string}[]>([]);
 const [account,setAccount]=useState('');const [loadedScope,setLoadedScope]=useState('');
 const [setupLoading,setSetupLoading]=useState(true);
 const [duplicateAllowed,setDuplicateAllowed]=useState(false),[duplicateConflicts,setDuplicateConflicts]=useState<DuplicateMatch[]>([]),[duplicateConfirmed,setDuplicateConfirmed]=useState(false),[conflictLoading,setConflictLoading]=useState(false);
 const [busy,setBusy]=useState(false);const [completed,setCompleted]=useState(false);const [error,setError]=useState('');
 const [draft,setDraft]=useState<{id:string;orderId:string;number:string}|null>(null);const [draftPosted,setDraftPosted]=useState(false);
 const dialog=useRef<HTMLElement>(null);const input=useRef<HTMLInputElement>(null);

 useEffect(()=>{
  let active=true;
  setAllowed(false);setPostAllowed(false);setAccounts([]);setAccount('');setLoadedScope('');
  setError('');setSetupLoading(!posted);
  if(posted)return()=>{active=false};
  if(!companyId||!businessUnitId){
   setSetupLoading(false);
   setError('Select an active Transport company and business unit to create an invoice.');
   return()=>{active=false};
  }
  void Promise.all([
   supabase.rpc('transport_draft_invoice_allowed',{p_side:'customer',p_action:'create'}),
   supabase.from('chart_of_accounts').select('id,name')
    .eq('company_id',companyId).eq('is_active',true).eq('is_group',false)
    .eq('type','revenue').order('name'),
   supabase.from('account_mappings').select('account_id')
    .eq('company_id',companyId).eq('mapping_key','service_revenue').limit(1).maybeSingle(),
   supabase.rpc('transport_draft_invoice_permissions'),
   supabase.rpc('transport_invoice_duplicate_override_allowed',{p_side:'customer'})
  ]).then(([permission,accountsResult,mapping,postPermission,duplicatePermission])=>{
   if(!active)return;
   if(permission.error)throw permission.error;if(postPermission.error)throw postPermission.error;if(duplicatePermission.error)throw duplicatePermission.error;setDuplicateAllowed(duplicatePermission.data===true);setPostAllowed(postPermission.data?.customer?.post===true);
   if(accountsResult.error)throw accountsResult.error;
   if(mapping.error)throw mapping.error;
   const currentAccounts=(accountsResult.data??[]) as {id:string;name:string}[];
   setAllowed(permission.data===true);
   const mapped=mapping.data?.account_id;
   const serviceAccounts=mapped?currentAccounts.filter(a=>a.id===mapped):[];
   setAccounts(serviceAccounts);
   setAccount(serviceAccounts[0]?.id??'');
   setLoadedScope(scope);
  }).catch((e:any)=>{if(active)setError(e?.message||'Unable to load invoice posting setup.')})
   .finally(()=>{if(active)setSetupLoading(false)});
  return()=>{active=false};
 },[posted,companyId,businessUnitId,scope]);

 const currentAccounts=loadedScope===scope?accounts:[];
 const currentAccount=loadedScope===scope?account:'';
 const currentAllowed=loadedScope===scope&&allowed;
 const loading=setupLoading||(!posted&&loadedScope!==scope&&!error);

 const number=invoiceNo.trim();
 const rateReady=trip.customer_rate_state==='finalized'&&Number(trip.customer_rate??0)>0;
 const blockers=invoicePostingBlockers({posted,loading,allowed:currentAllowed,rateReady,mode:numberMode,
  number,date,account:currentAccount,vatReady,withTax,validSaleType:saleType==='cash'||saleType==='credit'});
 const canPost=!busy&&!completed&&blockers.length===0&&!error&&!conflictLoading&&(!duplicateConflicts.length||(duplicateAllowed&&duplicateConfirmed));
 useEffect(()=>{
  let active=true;const value=invoiceNo.trim();setDuplicateConfirmed(false);setDuplicateConflicts([]);setConflictLoading(false);
  if(numberMode!=='manual'||!value||loadedScope!==scope)return;
  setError('');setConflictLoading(true);
  const timer=window.setTimeout(async()=>{try{const r=await supabase.rpc('transport_invoice_number_conflicts',{p_side:'customer',p_number:value});if(r.error)throw r.error;if(active)setDuplicateConflicts((r.data?.matches??[]) as DuplicateMatch[])}catch(e:any){if(active)setError(e?.message||'Could not check this invoice number.')}finally{if(active)setConflictLoading(false)}},300);
  return()=>{active=false;window.clearTimeout(timer)};
 },[invoiceNo,numberMode,loadedScope,scope]);

 async function saveDraft(){
  if(!canPost)return;setBusy(true);setError('');
  try{
   const result=await supabase.rpc('transport_create_customer_draft_grouped_with_override',{p_trip_ids:[trip.id],p_date:date,p_revenue_account_id:currentAccount,p_with_tax:withTax,p_invoice_no:numberMode==='manual'?number:null,p_descriptions:{},p_allow_duplicate_invoice:duplicateConflicts.length>0&&duplicateAllowed&&duplicateConfirmed});
   if(result.error)throw result.error;
   setCompleted(true);
   setInvoiceNo(String(result.data?.invoice_no||number));
   setDraft({id:String(result.data?.transport_document_id||''),orderId:String(result.data?.order_id||''),number:String(result.data?.invoice_no||number||'Draft')});
   setError('');await onChanged();
  }catch(e:any){setError(e?.message||'Unable to save customer invoice Draft. Refresh the Trip before retrying.')}finally{setBusy(false)}
 }
 async function postDraft(){
  if(!draft?.id||busy||!postAllowed||loadedScope!==scope)return;setBusy(true);setError('');
  try{const result=await supabase.rpc('transport_post_customer_draft',{p_document_id:draft.id});if(result.error)throw result.error;setDraftPosted(true);await onChanged();}
  catch(e:any){setError(e?.message||'Unable to post customer Draft. Refresh the Register before retrying.')}
  finally{setBusy(false)}
 }

 return <TransportDialog  onKeyDown={e=>{if(e.key==='Escape'&&!busy)onClose();if(e.key==='Tab'){const items=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)');if(items?.length){const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}}}}>
  <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="trip-invoice-title" className="w-full max-w-sm rounded bg-white p-4 text-sm shadow-xl">
   <h2 id="trip-invoice-title" className="font-semibold">Customer Invoice · {trip.trip_no}</h2>
   <p className="my-2 text-xs text-slate-600">{trip.customer_name}<br/>{trip.from_location} → {trip.to_location}<br/>Company Rate excluding VAT: {trip.customer_rate==null?'—':Number(trip.customer_rate).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</p>
   {posted||completed?<label className="block text-xs font-semibold">Invoice Number<input className="input mt-1 w-full" value={invoiceNo||(completed?'Draft saved':'Posted · original reference missing')} readOnly /></label>:<>
    <label className="block text-xs font-semibold">Invoice Number Method
     <NaviloSearchableSelect nativeCompatibility preserveLabel aria-label="Invoice number method" className="input mt-1 w-full" value={numberMode} disabled={busy} onChange={e=>setNumberMode(e.target.value as 'choose'|'auto'|'manual')}>
      <option value="choose">Choose method…</option>{!withTax&&<option value="auto">Generate NAVILO number</option>}<option value="manual">Enter own invoice number</option>
     </NaviloSearchableSelect>
    </label>
    {numberMode==='manual'&&<label className="mt-2 block text-xs font-semibold">Your Invoice Number<input ref={input} className="input mt-1 w-full" value={invoiceNo} disabled={busy} onChange={e=>setInvoiceNo(e.target.value)} placeholder="Enter invoice number" />
     {conflictLoading&&<span className="mt-1 block text-slate-600">Checking invoice number…</span>}
     {duplicateConflicts.length>0&&<div role="status" className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"><strong>This number is already used:</strong><ul className="mt-1 list-inside list-disc">{duplicateConflicts.map((hit,i)=><li key={hit.company+'-'+hit.date+'-'+i}>{hit.company} · {hit.date} · {hit.status} · {hit.trips?.length?'Trip '+hit.trips.join(', '):'no linked trip'}</li>)}</ul>{duplicateAllowed?<label className="mt-2 flex items-start gap-2"><input type="checkbox" checked={duplicateConfirmed} onChange={e=>setDuplicateConfirmed(e.target.checked)}/><span>I have permission to save this duplicate invoice number.</span></label>:<p className="mt-2 font-semibold">Only a company owner, admin, or user with duplicate-invoice permission can continue.</p>}</div>}
    </label>}
    {numberMode==='auto'&&<p className="mt-2 text-xs text-slate-600">NAVILO will assign its next available number when you save the Draft.</p>}
   </>}
   {posted||completed
    ?<div role="status" className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{completed?(draftPosted?'Invoice posted.':'Draft saved. It has no accounting entry until you post it.'):'This canonical Sales invoice is already posted. Its invoice number is locked and is not overwritten from the Trips grid.'}{completed&&draft?.orderId&&<p className="mt-2"><a className="underline" href={`/sales/${encodeURIComponent(draft.orderId)}`} target="_blank" rel="noreferrer">Review Draft</a></p>}</div>
    :<>
      <label className="mt-2 block text-xs font-semibold">Service Revenue Account
       <NaviloSearchableSelect nativeCompatibility preserveLabel aria-label="Service revenue account" className="input mt-1 w-full" value={currentAccount} disabled={busy||loading} onChange={e=>setAccount(e.target.value)}><option value="">Map Service Revenue first</option>{currentAccounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</NaviloSearchableSelect>
      </label>
      <label className="mt-2 block text-xs font-semibold">Invoice Date
       <NaviloDateInput className="input mt-1 w-full" type="date" value={date} disabled={busy} onChange={e=>{setVatReady(!withTax);setDate(e.target.value)}}/>
      </label>
      <p className="mt-2 text-xs font-semibold">{withTax?'Credit · VAT automatic':'Cash · Without VAT'}</p>
      <TransportVatPreview side="customer" date={date} withTax={withTax} amounts={[Number(trip.customer_rate??0)]} onReady={setVatReady}/>
      {blockers.length>0&&<div role="status" aria-label="Invoice posting requirements" className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
       <strong>Invoice cannot be posted yet:</strong>
       <ul className="mt-1 list-inside list-disc">{blockers.map(reason=><li key={reason}>{reason}</li>)}</ul>
      </div>}
      <p className="mt-2 text-xs text-slate-600">Save Draft creates the canonical Sales/service invoice without posting. {withTax?'Credit invoices require the original invoice number you provide.':'Choose automatic numbering or enter your own invoice number.'}</p>
    </>}
   {error&&<p role="alert" className="my-2 text-red-700">{error}</p>}
   <div className="mt-3 flex justify-end gap-2"><button className="btn" disabled={busy} onClick={onClose}>Close</button>{!posted&&!completed&&<button className="btn-primary" disabled={!canPost} onClick={()=>void saveDraft()}>{busy?'Saving…':'Save Draft'}</button>}{completed&&!draftPosted&&<button className="btn-primary" disabled={busy||!draft?.id||!postAllowed||loadedScope!==scope} onClick={()=>void postDraft()}>{busy?'Posting…':'Post Invoice'}</button>}</div>
  </section>
 </TransportDialog>;
}
