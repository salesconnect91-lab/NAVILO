import OwnerInvoiceCancellationReview from "@/modules/accounting/OwnerInvoiceCancellationReview";
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
type Line={id:string;description:string;amount:number;tax_percent:number;source_module?:string};
type Charge={id:string;charge_key:string;charge_label:string|null;amount:number;tax_percent:number};
export default function TransportServiceDocument({side,id,canPrint=true,canPost=false,canDelete=false}:{side:'customer'|'supplier';id:string;canPrint?:boolean;canPost?:boolean;canDelete?:boolean}){
 const navigate=useNavigate();
 const [external,setExternal]=useState<any[]>([]);const [revision,setRevision]=useState(0);
 const [trips,setTrips]=useState<any[]>([]);const [order,setOrder]=useState<any>(null);const [lines,setLines]=useState<Line[]>([]);const [charges,setCharges]=useState<Charge[]>([]);const [company,setCompany]=useState<any>({});
 const [balance,setBalance]=useState<ServiceBalance|null>(null);const [cash,setCash]=useState(false);const [error,setError]=useState('');const [deleting,setDeleting]=useState(false);
 const deleteDraft=async()=>{
  if(side!=='customer'||order?.status!=='draft'||!canDelete||deleting)return;
  if(!window.confirm(`Delete draft Sales Invoice ${order.order_no}? Its unposted import lines will also be removed. This cannot be undone.`))return;
  setDeleting(true);setError('');
  try{
   const {data,error:rpcError}=await supabase.rpc('delete_draft_sales_invoice',{p_order_id:id});
   if(rpcError)throw rpcError;
   if(data!==true)throw new Error('Draft invoice could not be deleted.');
   navigate('/sales');
  }catch(e:any){setError(e?.message||'Unable to delete draft Sales Invoice.')}
  finally{setDeleting(false);}
 };
 useEffect(()=>{let live=true;setOrder(null);setExternal([]);setError('');void Promise.all([
 supabase.from(side==='customer'?'sales_orders':'purchase_orders').select(side==='customer'?'*,party:customers(*)':'*,party:suppliers(*)').eq('id',id).single(),
 fetchAllPages<Line>((from,to)=>supabase.from(side==='customer'?'sales_service_lines':'purchase_service_lines').select('id,description,amount,tax_percent,source_module').eq('order_id',id).order('id').range(from,to)),
 fetchAllPages<Charge>((from,to)=>supabase.from(side==='customer'?'sales_order_charges':'purchase_order_charges').select('id,charge_key,charge_label,amount,tax_percent').eq('order_id',id).order('id').range(from,to)),
 supabase.from('company_settings').select('*').maybeSingle(),supabase.from('transport_service_document_balances').select('*').eq('side',side).eq('order_id',id).maybeSingle(),
 supabase.rpc('transport_document_trip_details',{p_side:side,p_order_id:id}),
 side==='customer'?supabase.from('transport_customer_documents').select('document_kind').eq('sales_order_id',id).maybeSingle():Promise.resolve({data:null,error:null})
 ]).then(async([o,l,ch,c,b,t,k])=>{for(const result of [o,c,b,t,k])if(result.error)throw result.error;const ext=side==='customer'&&l.some(line=>line.source_module==='external_transport')?await fetchAllPages<any>((from,to)=>supabase.from('transport_external_invoice_register').select('*').eq('sales_order_id',id).order('id').range(from,to)):[];if(live){setExternal(ext);setOrder(o.data);setTrips(t.data||[]);setLines(l);setCharges(ch);setCompany(c.data??{});setBalance(b.data);setCash(k.data?.document_kind==='cash_hand_bill')}}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[side,id,revision]);
 if(error)return <p role="alert" className="text-red-700">{error}</p>;if(!order)return <p>Loading service document…</p>;
 const baseNet=lines.reduce((sum,l)=>sum+Number(l.amount),0);const chargesNet=charges.reduce((sum,x)=>sum+Number(x.amount),0);const net=baseNet+chargesNet;const vat=lines.reduce((sum,l)=>sum+Math.round(Number(l.amount)*Number(l.tax_percent))/100,0)+charges.reduce((sum,x)=>sum+Math.round(Number(x.amount)*Number(x.tax_percent))/100,0);
 const title=side==='supplier'?'Purchase Service Invoice':String(order.transport_source_invoice_id||'').startsWith('debit:')?'Sales Debit Note':cash||order.payment_mode==='Cash'?'Cash Hand Bill':order.invoice_type==='Tax Invoice'?'Tax Invoice':'Sales Invoice';
 return <div><OwnerInvoiceCancellationReview side={side==='customer'?'sales':'purchase'} documentId={order.id} posted={order.status==='posted'} /><div className="print:hidden"><div className="mb-3 flex items-center justify-between"><h1 className="text-lg font-semibold">{title} · {order.order_no}</h1><div className="flex gap-2"><Link className="btn" to={side==='customer'?'/sales':'/purchase'}>Back</Link>{side==='customer'&&order.status==='draft'&&canDelete&&<button type="button" className="btn border border-rose-200 text-rose-700" disabled={deleting} onClick={()=>void deleteDraft()}>{deleting?'Deleting…':'Delete Draft'}</button>}{canPrint&&<button className="btn" onClick={()=>triggerPrint("#transport-service-print-document")}>Print</button>}</div></div><p>{order.party?.name} · {order.order_date} · {order.status}</p>
 <table className="my-3 w-full text-sm"><thead><tr><th className="text-left">Service / Charge</th><th className="text-left">Description</th><th className="text-right">Amount excluding VAT</th><th className="text-right">VAT</th><th className="text-right">Total</th></tr></thead><tbody>{lines.map(l=><tr key={l.id} className="border-t"><td>Route / Base Rent</td><td className="whitespace-pre-wrap">{l.description}</td><td className="text-right">{financialNumber(l.amount)}</td><td className="text-right">{financialNumber(Number(l.amount)*Number(l.tax_percent)/100)}</td><td className="text-right">{financialNumber(Number(l.amount)*(1+Number(l.tax_percent)/100))}</td></tr>)}{charges.map(x=><tr key={x.id} className="border-t"><td>{side==='customer'?'Customer Charge':'Supplier Charge'}</td><td>{x.charge_label||x.charge_key}</td><td className="text-right">{financialNumber(x.amount)}</td><td className="text-right">{financialNumber(Number(x.amount)*Number(x.tax_percent)/100)}</td><td className="text-right">{financialNumber(Number(x.amount)*(1+Number(x.tax_percent)/100))}</td></tr>)}</tbody><tfoot><tr className="border-t font-semibold"><td colSpan={2}>Net Total · Base {financialNumber(baseNet)} + Charges {financialNumber(chargesNet)}</td><td className="text-right">{financialNumber(net)}</td><td className="text-right">{financialNumber(vat)}</td><td className="text-right">{financialNumber(net+vat)}</td></tr></tfoot></table>
 {trips.length>0&&<ConfigurableReport preferenceKey={`${side}:service-invoice-trips`} report={{title:'Transport service Trip details',description:'Vehicle / Driver captured at original posting; missing history is left unattributed.',columns:['Trip','Date','From','To','Vehicle','Driver','Owner','Job / PO / DO'],rows:trips.map(t=>[t.trip_no,t.trip_date,t.from_location,t.to_location,vehicleDisplayLabel(t.vehicle_no,t.truck_type)||'Unattributed',t.driver_name||'Unattributed',t.owner_name||'',t.po_do_job_no||''])}}/>}
 {external.length>0&&<ExternalInvoiceDetails order={order} rows={external} canPost={canPost} onChanged={()=>setRevision(v=>v+1)}/>}
 {side==='supplier'&&<p>Supplier invoice reference: {order.supplier_invoice_no||'—'} · Supplier invoice date: {order.supplier_invoice_date||'—'}</p>}
 <p>Invoice total including VAT: {financialNumber(order.status==='posted'?order.total:net+vat)} · Current billed total after credits: {financialNumber(balance?.billed_gross??order.total)} · Outstanding: {financialNumber(balance?.outstanding_gross??order.outstanding_amount)} · Credit / refund: {financialNumber(balance?.credit_gross??0)}</p>{external.length===0&&<p className="mt-3"><Link to="/transport" className="text-blue-700 underline">Open Trip Finance for allocation, settlement and rate adjustments</Link></p>}</div>
 <div id="transport-service-print-document" className="hidden print:block"><PrintLayout voucherTitle={title} voucherNo={order.order_no} voucherDate={order.order_date}
 company={{name:company.company_name,address:company.address,phone:company.phone,email:company.email,logoUrl:company.logo_url,taxId:[company.ntn,company.strn].filter(Boolean).join(' / ')}}
 party={{name:order.party?.name??'—',address:order.party?.address,phone:order.party?.phone,ntn:order.party?.ntn,strn:order.party?.strn}}
 items={lines.map(l=>({name:'Transport service',description:l.description,qty:1,unitPrice:Number(l.amount),lineTotal:Number(l.amount),taxPercent:Number(l.tax_percent),taxAmount:Math.round(Number(l.amount)*Number(l.tax_percent))/100,unit:'Service'}))}
 chargeBreakdown={charges.map(x=>({label:x.charge_label||x.charge_key,amount:Number(x.amount)}))} itemsTotal={baseNet} chargesTotal={chargesNet} taxAmount={vat} showTaxSummary={vat>0} grandTotal={order.status==='posted'?Number(order.total):net+vat} discountAmount={Number(order.discount_amount??0)}
 documentDetails={external.length>0?<section className="print-consolidated-box"><h3>Vehicle details</h3><table><thead><tr><th>Source reference</th><th>Source date</th><th>Vehicle / Driver</th><th>Route</th><th>Job / PO / DO</th><th>Amount excluding VAT</th></tr></thead><tbody>{external.map(r=><tr key={r.id}><td>{r.reference_trip_no||r.source_reference}</td><td>{formatNaviloDate(r.reference_date)}</td><td>{r.vehicle_no} / {r.driver_name||'—'}</td><td>{r.from_location} → {r.to_location}</td><td>{r.job_no||'—'}</td><td>{financialNumber(Number(r.original_net))}</td></tr>)}</tbody></table></section>:trips.length>0?<section className="print-consolidated-box"><h3>Trip details</h3><table><thead><tr><th>Trip</th><th>Date</th><th>Route</th><th>Vehicle / Driver</th><th>Job / PO / DO</th></tr></thead><tbody>{trips.map(t=><tr key={t.trip_id}><td>{t.trip_no}</td><td>{formatNaviloDate(t.trip_date)}</td><td>{t.from_location} → {t.to_location}</td><td>{vehicleDisplayLabel(t.vehicle_no,t.truck_type)||'Unattributed'} / {t.driver_name||'Unattributed'}</td><td>{t.po_do_job_no||'—'}</td></tr>)}</tbody></table></section>:undefined}
 extraFields={[{label:'Status',value:order.status},...(balance?[{label:'Current billed total',value:financialNumber(balance.billed_gross)},{label:side==='supplier'?'Paid':'Received',value:financialNumber(balance.paid_gross)},{label:'Outstanding',value:financialNumber(balance.outstanding_gross)},{label:'Credit / refund',value:financialNumber(balance.credit_gross)}]:[]),...(side==='supplier'?[{label:'Supplier Invoice',value:order.supplier_invoice_no||'—'},{label:'Supplier Invoice Date',value:order.supplier_invoice_date?formatNaviloDate(order.supplier_invoice_date):'—'}]:[])]}
 documentNotice="Service document. Posted source amounts remain historical; later credits and rate adjustments are separate documents."/>
 </div></div>;
}
