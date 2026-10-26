import TransportReasonSelect from './TransportReasonSelect';
import {recordDisplayText} from '@/lib/recordDisplayText';
import OwnerInvoiceCancellationReview from "@/modules/accounting/OwnerInvoiceCancellationReview";
import TransportPostedInvoiceControls from './TransportPostedInvoiceControls';
import TransportCreditedTripInvoiceRelease from './TransportCreditedTripInvoiceRelease';
import ExternalInvoiceDetails from './ExternalInvoiceDetails';
import {triggerPrint} from "@/lib/exportUtils";
import {vehicleDisplayLabel} from "@/lib/transportVehicleLabel";
import {formatNaviloDate} from "@/lib/naviloDate";
import ConfigurableReport from './ConfigurableReport';
import {useEffect,useState} from 'react';
import {Link,useNavigate} from 'react-router-dom';
import {supabase} from '@/lib/supabase';
import PrintLayout from '@/components/PrintLayout';
import {fetchAllPages} from '@/lib/fetchAllPages';
import {financialNumber,type ServiceBalance} from './transportFinancialTypes';
import {deleteDraftCommercialInvoice} from '@/lib/deleteDraftCommercialInvoice';
import {transportServicePrintDescription} from './transportServicePrintDescription';
type Line={id:string;description:string;amount:number;tax_percent:number;source_module?:string;historical_vat_amount?:number|string|null};
const serviceLineVat=(line:Line)=>line.historical_vat_amount==null?Math.round(Number(line.amount)*Number(line.tax_percent))/100:Number(line.historical_vat_amount);
type Charge={id:string;charge_key:string;charge_label:string|null;amount:number;tax_percent:number};
export default function TransportServiceDocument({side,id,canPrint=true,canPost=false,canDelete=false,canReverse=false}:{side:'customer'|'supplier';id:string;canPrint?:boolean;canPost?:boolean;canDelete?:boolean;canReverse?:boolean}){
 const navigate=useNavigate();
 const [external,setExternal]=useState<any[]>([]);const [revision,setRevision]=useState(0);
 const [trips,setTrips]=useState<any[]>([]);const [order,setOrder]=useState<any>(null);const [registerInvoiceNos,setRegisterInvoiceNos]=useState<string[]>([]);const [lines,setLines]=useState<Line[]>([]);const [charges,setCharges]=useState<Charge[]>([]);const [company,setCompany]=useState<any>({});const [transportAttributed,setTransportAttributed]=useState(false);
 const [balance,setBalance]=useState<ServiceBalance|null>(null);const [cash,setCash]=useState(false);const [error,setError]=useState('');const [success,setSuccess]=useState('');const [deleting,setDeleting]=useState(false);
 const [reverseOpen,setReverseOpen]=useState(false);const [reverseDate,setReverseDate]=useState(()=>new Date().toISOString().slice(0,10));const [reverseReason,setReverseReason]=useState('');const [reversing,setReversing]=useState(false);
 const [posting,setPosting]=useState(false);
 async function postStandaloneDraft(){
  if(!order||order.status==='posted'||posting)return;
  setPosting(true);setError('');
  try{
   const {error:postError}=await supabase.rpc(side==='customer'?'post_sales_invoice':'post_purchase_invoice',{p_order_id:order.id});
   if(postError)throw postError;
   setRevision(v=>v+1);
  }catch(e:any){setError(e?.message||'Unable to post the normal invoice.');}
  finally{setPosting(false)}
 }
 const deleteDraft=async()=>{
  if(order?.status!=='draft'||!canDelete||deleting)return;
  if(!window.confirm(`Delete draft ${side==='customer'?'Sales':'Purchase'} Invoice ${order.order_no}? Its unposted transport lines and trip links will also be removed. This cannot be undone.`))return;
  setDeleting(true);setError('');
  try{
   await deleteDraftCommercialInvoice(supabase,side,id);
   navigate(side==='customer'?'/sales':'/purchase');
  }catch(e:any){setError(e?.message||`Unable to delete draft ${side==='customer'?'Sales':'Purchase'} Invoice.`)}
  finally{setDeleting(false);}
 };
 const reversePostedServiceInvoice=async()=>{
  if(!canReverse||order?.status!=='posted'||reversing||!reverseReason.trim()||!reverseDate)return;
  if(!window.confirm(`Post a full ${side==='customer'?'credit':'debit'} note for ${order.order_no}? The original invoice and journal will remain in audit history.`))return;
  setReversing(true);setError('');setSuccess('');
  try{
   const {data,error:rpcError}=await supabase.rpc('transport_reverse_service_invoice',{p_side:side,p_order_id:id,p_note_date:reverseDate,p_reason:reverseReason.trim()} as any);
   if(rpcError)throw rpcError;
   if(data?.success!==true)throw new Error('The database did not confirm the full reversal.');
   setSuccess(`${side==='customer'?'Credit':'Debit'} note ${data.note_no||''} posted for SAR ${Number(data.total||0).toLocaleString('en-SA',{minimumFractionDigits:2,maximumFractionDigits:2})}. Original invoice remains in history.`);
   setReverseOpen(false);setReverseReason('');setRevision(v=>v+1);
  }catch(e:any){setError(e?.message||'Unable to post the full invoice reversal.');}
  finally{setReversing(false);}
 };
 useEffect(()=>{let live=true;setOrder(null);setExternal([]);setTransportAttributed(false);setError('');void Promise.all([
 supabase.from(side==='customer'?'sales_orders':'purchase_orders').select(side==='customer'?'*,party:customers(*)':'*,party:suppliers(*)').eq('id',id).single(),
 fetchAllPages<Line>((from,to)=>supabase.from(side==='customer'?'sales_service_lines':'purchase_service_lines').select('id,description,amount,tax_percent,source_module,historical_vat_amount').eq('order_id',id).order('id').range(from,to)),
 fetchAllPages<Charge>((from,to)=>supabase.from(side==='customer'?'sales_order_charges':'purchase_order_charges').select('id,charge_key,charge_label,amount,tax_percent').eq('order_id',id).order('id').range(from,to)),
 supabase.from('company_settings').select('*').maybeSingle(),supabase.from('transport_service_document_balances').select('*').eq('side',side).eq('order_id',id).maybeSingle(),
 supabase.rpc('transport_document_trip_details',{p_side:side,p_order_id:id}),
 side==='customer'?supabase.from('transport_customer_documents').select('document_kind,journal_entry_id').eq('sales_order_id',id).maybeSingle():supabase.from('transport_supplier_documents').select('journal_entry_id').eq('purchase_order_id',id).maybeSingle()
 ]).then(async([o,l,ch,c,b,t,k])=>{for(const result of [o,c,b,t,k])if(result.error)throw result.error;const ext=side==='customer'&&l.some(line=>line.source_module==='external_transport')?await fetchAllPages<any>((from,to)=>supabase.from('transport_external_invoice_register').select('*').eq('sales_order_id',id).order('id').range(from,to)):[];const tripRows=t.data||[];let invoiceNos:string[]=[];if(tripRows.length){const tripRefs=await supabase.from('transport_financial_register').select('id,source_invoice_no,historical_customer_invoice_ref,historical_supplier_invoice_ref').in('id',[...new Set(tripRows.map((row:any)=>row.trip_id).filter(Boolean))]);if(!tripRefs.error){const field=side==='customer'?'historical_customer_invoice_ref':'historical_supplier_invoice_ref';invoiceNos=[...new Set((tripRefs.data??[]).map((row:any)=>String(row[field]??(side==='customer'?row.source_invoice_no:'')??'').trim()).filter(Boolean))]}}if(side==='supplier'&&!invoiceNos.length&&String(o.data?.supplier_invoice_no??'').trim())invoiceNos=[String(o.data.supplier_invoice_no).trim()];const customerDocumentKind=(k.data as {document_kind?:string}|null)?.document_kind;if(live){setExternal(ext);setOrder(o.data);setTrips(tripRows);setRegisterInvoiceNos(invoiceNos);setLines(l);setCharges(ch);setCompany(c.data??{});setBalance(b.data);setCash(side==='customer'&&customerDocumentKind==='cash_hand_bill');setTransportAttributed(Boolean(k.data?.journal_entry_id))}}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[side,id,revision]);
 if(!order)return error?<p role="alert" className="text-red-700">{error}</p>:<p>Loading service document…</p>;
 const baseNet=lines.reduce((sum,l)=>sum+Number(l.amount),0);const chargesNet=charges.reduce((sum,x)=>sum+Number(x.amount),0);const net=baseNet+chargesNet;const vat=lines.reduce((sum,l)=>sum+serviceLineVat(l),0)+charges.reduce((sum,x)=>sum+Math.round(Number(x.amount)*Number(x.tax_percent))/100,0);
 const showVat=order.invoice_type==='Tax Invoice'||vat!==0;
 const standalone=lines.some(l=>l.source_module==='transport_normal');
 const expenseBill=side==='supplier'&&lines.some(l=>l.source_module==='general_expense_bill');
 const manualPost=standalone||expenseBill;
 const title=expenseBill?'Expense Bill':standalone?(side==='customer'?'Normal Sales Invoice':'Normal Purchase Invoice'):side==='supplier'?'Purchase Service Invoice':String(order.transport_source_invoice_id||'').startsWith('debit:')?'Sales Debit Note':cash||order.payment_mode==='Cash'?'Cash Hand Bill':order.invoice_type==='Tax Invoice'?'Tax Invoice':'Sales Invoice';
 const savedInvoiceNumber=String(order.order_no||'').trim();
 const customerInvoiceNumber=registerInvoiceNos.join(", ")||(/^H-[SP](?:-|$)/i.test(savedInvoiceNumber)?'':savedInvoiceNumber);
 const invoiceNumber=side==='supplier'?savedInvoiceNumber:customerInvoiceNumber;
 const directTripInvoice=transportAttributed&&lines.length>0&&lines.every(line=>line.source_module==='transport');
 return <div>{error&&<p role="alert" className="mb-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}{success&&<p role="status" className="mb-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{success}</p>}{!directTripInvoice&&<OwnerInvoiceCancellationReview side={side==='customer'?'sales':'purchase'} documentId={order.id} posted={order.status==='posted'} />}<div className="print:hidden"><div className="mb-3 flex items-center justify-between"><div><h1 className="text-lg font-semibold">{title}</h1><p className="text-sm text-slate-600">{expenseBill?'Supplier invoice:':side==='supplier'?'NAVILO invoice #:':'Register invoice:'} {expenseBill?recordDisplayText(order.supplier_invoice_no)||'—':invoiceNumber||"not entered"}</p></div><div className="flex gap-2"><Link className="btn" to={side==='customer'?'/sales':'/purchase'}>Back</Link>{order.status==='draft'&&canDelete&&<button type="button" className="btn border border-rose-200 text-rose-700" disabled={deleting} onClick={()=>void deleteDraft()}>{deleting?'Deleting…':'Delete Draft'}</button>}{manualPost&&order.status==='draft'&&canPost&&<button type="button" className="btn-primary" disabled={posting} onClick={()=>void postStandaloneDraft()}>{posting?'Posting…':expenseBill?'Post Expense Bill':`Post Normal ${side==='customer'?'Sales':'Purchase'} Invoice`}</button>}{order.status==='posted'&&directTripInvoice&&!manualPost&&!expenseBill&&<><TransportPostedInvoiceControls side={side} order={order} onSaved={()=>{setSuccess('Posted invoice updated in place. Invoice number and record ID were preserved without a reversal.');setRevision(v=>v+1)}}/><TransportCreditedTripInvoiceRelease side={side} order={{id:order.id,order_no:order.order_no,status:order.status}} trips={trips} lineCount={lines.length} chargesCount={charges.length} balance={balance} transportAttributed={transportAttributed} cash={cash} onReleased={(invoiceNo,tripNo)=>{setSuccess(`Invoice ${invoiceNo} stays in history; Trip ${tripNo} is released for a future invoice.`);setRevision(v=>v+1)}}/></>}{order.status==='posted'&&canReverse&&transportAttributed&&!manualPost&&!expenseBill&&<button type="button" className="btn-danger" onClick={()=>setReverseOpen(v=>!v)}>{reverseOpen?'Close':`Issue ${side==='customer'?'Credit':'Debit'} Note`}</button>}{canPrint&&<button className="btn" onClick={()=>triggerPrint("#transport-service-print-document")}>Print</button>}</div></div>{reverseOpen&&order.status==='posted'&&canReverse&&transportAttributed&&!manualPost&&!expenseBill&&<section className="mb-3 rounded-md border border-rose-200 bg-rose-50 p-3" aria-label="Full service invoice reversal"><p className="mb-2 text-xs text-rose-900">This posts a full {side==='customer'?'credit':'debit'} note using the original journal lines. The posted invoice stays in the audit history.</p><div className="flex flex-wrap items-end gap-2"><label className="text-xs">Note date<input aria-label="Reversal note date" className="input mt-1" type="date" value={reverseDate} onChange={e=>setReverseDate(e.target.value)}/></label><div className="min-w-64 flex-1 text-xs"><TransportReasonSelect kind="invoice_note" label="Reversal reason" value={reverseReason} onChange={setReverseReason} disabled={reversing}/></div><button type="button" className="btn-danger" disabled={reversing||!reverseDate||!reverseReason.trim()} onClick={()=>void reversePostedServiceInvoice()}>{reversing?'Posting note…':`Post Full ${side==='customer'?'Credit':'Debit'} Note`}</button></div></section>}<p>{order.party?.name} · {order.order_date} · {order.status}</p>
 {order.transport_conversion_error&&<p role="alert" className="my-2 text-amber-800">Imported invoice is Draft: {order.transport_conversion_error}</p>}
 <table className="my-3 w-full text-sm"><thead><tr><th className="text-left">Service / Charge</th><th className="text-left">Description</th><th className="text-right">{showVat?'Amount excluding VAT':'Amount'}</th>{showVat&&<th className="text-right">VAT</th>}<th className="text-right">Total</th></tr></thead><tbody>{lines.map(l=><tr key={l.id} className="border-t"><td>{standalone?'Service':'Route / Base Rent'}</td><td className="whitespace-pre-wrap">{recordDisplayText(l.description)}</td><td className="text-right">{financialNumber(l.amount)}</td>{showVat&&<td className="text-right">{financialNumber(serviceLineVat(l))}</td>}<td className="text-right">{financialNumber(Number(l.amount)+serviceLineVat(l))}</td></tr>)}{charges.map(x=><tr key={x.id} className="border-t"><td>{side==='customer'?'Customer Charge':'Supplier Charge'}</td><td>{x.charge_label||x.charge_key}</td><td className="text-right">{financialNumber(x.amount)}</td>{showVat&&<td className="text-right">{financialNumber(Number(x.amount)*Number(x.tax_percent)/100)}</td>}<td className="text-right">{financialNumber(Number(x.amount)*(1+Number(x.tax_percent)/100))}</td></tr>)}</tbody><tfoot><tr className="border-t font-semibold"><td colSpan={2}>Net Total · Base {financialNumber(baseNet)} + Charges {financialNumber(chargesNet)}</td><td className="text-right">{financialNumber(net)}</td>{showVat&&<td className="text-right">{financialNumber(vat)}</td>}<td className="text-right">{financialNumber(net+vat)}</td></tr></tfoot></table>
 {trips.length>0&&<ConfigurableReport preferenceKey={`${side}:service-invoice-trips`} report={{title:'Transport service Trip details',description:'Vehicle / Driver captured at original posting; missing source details are left unattributed.',columns:['Trip','Date','From','To','Vehicle','Driver','Owner','Job / PO / DO'],rows:trips.map(t=>[t.trip_no,t.trip_date,t.from_location,t.to_location,vehicleDisplayLabel(t.vehicle_no,t.truck_type)||'Unattributed',t.driver_name||'Unattributed',t.owner_name||'',t.po_do_job_no||''])}}/>}
 {external.length>0&&<ExternalInvoiceDetails order={order} rows={external} canPost={canPost} onChanged={()=>setRevision(v=>v+1)}/>}
 {side==='supplier'&&<p>Supplier invoice reference: {recordDisplayText(order.supplier_invoice_no)||'—'} · Supplier invoice date: {order.supplier_invoice_date||'—'}</p>}
 <p>{showVat?'Invoice total including VAT:':'Bill total:'} {financialNumber(order.status==='posted'?order.total:net+vat)} · Current billed total after credits: {financialNumber(balance?.billed_gross??order.total)} · Outstanding: {financialNumber(balance?.outstanding_gross??(standalone?Math.max(0,Number(order.total??0)-Number(order.paid_amount??0)):order.outstanding_amount))} · Credit / refund: {financialNumber(balance?.credit_gross??0)}</p>{external.length===0&&<p className="mt-3"><Link to={standalone||expenseBill?`/accounting/cash-counter?mode=${side==='customer'?'customer':'supplier'}`:'/transport'} className="text-blue-700 underline">{standalone||expenseBill?'Record or allocate payment in Accounting':'Open Trip Finance for allocation, settlement and rate adjustments'}</Link></p>}</div>
 <div id="transport-service-print-document" className="hidden print:block"><PrintLayout voucherTitle={title} voucherNo={invoiceNumber||"—"} voucherDate={order.order_date}
 company={{name:company.company_name,address:company.address,phone:company.phone,email:company.email,logoUrl:company.logo_url,taxId:[company.ntn,company.strn].filter(Boolean).join(' / ')}}
 party={{name:order.party?.name??'—',address:order.party?.address,phone:order.party?.phone,ntn:order.party?.ntn,strn:order.party?.strn}}
 items={lines.map(l=>({name:standalone?'Service':'Transport service',description:transportServicePrintDescription(l.description,l.source_module),qty:1,unitPrice:Number(l.amount),lineTotal:Number(l.amount),taxPercent:Number(l.tax_percent),taxAmount:serviceLineVat(l),unit:'Service'}))}
 chargeBreakdown={charges.map(x=>({label:x.charge_label||x.charge_key,amount:Number(x.amount)}))} itemsTotal={baseNet} chargesTotal={chargesNet} taxAmount={vat} showTaxSummary={showVat} grandTotal={order.status==='posted'?Number(order.total):net+vat} discountAmount={Number(order.discount_amount??0)}
 documentDetails={external.length>0?<section className="print-consolidated-box"><h3>Vehicle details</h3><table><thead><tr><th>Source reference</th><th>Source date</th><th>Vehicle / Driver</th><th>Route</th><th>Job / PO / DO</th><th>{showVat?'Amount excluding VAT':'Amount'}</th></tr></thead><tbody>{external.map(r=><tr key={r.id}><td>{r.reference_trip_no||r.source_reference}</td><td>{formatNaviloDate(r.reference_date)}</td><td>{r.vehicle_no} / {r.driver_name||'—'}</td><td>{r.from_location} → {r.to_location}</td><td>{r.job_no||'—'}</td><td>{financialNumber(Number(r.original_net))}</td></tr>)}</tbody></table></section>:trips.length>0?<section className="print-consolidated-box"><h3>Trip details</h3><table><thead><tr><th>Trip</th><th>Date</th><th>Route</th><th>Vehicle / Driver</th><th>Job / PO / DO</th></tr></thead><tbody>{trips.map(t=><tr key={t.trip_id}><td>{t.trip_no}</td><td>{formatNaviloDate(t.trip_date)}</td><td>{t.from_location} → {t.to_location}</td><td>{vehicleDisplayLabel(t.vehicle_no,t.truck_type)||'Unattributed'} / {t.driver_name||'Unattributed'}</td><td>{t.po_do_job_no||'—'}</td></tr>)}</tbody></table></section>:undefined}
 extraFields={[{label:'Status',value:order.status},...(balance?[{label:'Current billed total',value:financialNumber(balance.billed_gross)},{label:side==='supplier'?'Paid':'Received',value:financialNumber(balance.paid_gross)},{label:'Outstanding',value:financialNumber(balance.outstanding_gross)},{label:'Credit / refund',value:financialNumber(balance.credit_gross)}]:[]),...(side==='supplier'?[{label:'Supplier Invoice',value:recordDisplayText(order.supplier_invoice_no)||'—'},{label:'Supplier Invoice Date',value:order.supplier_invoice_date?formatNaviloDate(order.supplier_invoice_date):'—'}]:[])]}
 documentNotice={order.status==='draft'?'DRAFT COPY — Not issued or posted. For review only.':undefined}/>
 </div></div>;
}
