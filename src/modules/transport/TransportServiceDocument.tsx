import ConfigurableReport from './ConfigurableReport';
import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {supabase} from '@/lib/supabase';
import PrintLayout from '@/components/PrintLayout';
import {fetchAllPages} from '@/lib/fetchAllPages';
import {financialNumber,type ServiceBalance} from './transportFinancialTypes';
type Line={id:string;description:string;amount:number;tax_percent:number};
export default function TransportServiceDocument({side,id,canPrint=true}:{side:'customer'|'supplier';id:string;canPrint?:boolean}){
 const [trips,setTrips]=useState<any[]>([]);const [order,setOrder]=useState<any>(null);const [lines,setLines]=useState<Line[]>([]);const [company,setCompany]=useState<any>({});
 const [balance,setBalance]=useState<ServiceBalance|null>(null);const [cash,setCash]=useState(false);const [error,setError]=useState('');
 useEffect(()=>{let live=true;setOrder(null);void Promise.all([
 supabase.from(side==='customer'?'sales_orders':'purchase_orders').select(side==='customer'?'*,party:customers(*)':'*,party:suppliers(*)').eq('id',id).single(),
 fetchAllPages<Line>((from,to)=>supabase.from(side==='customer'?'sales_service_lines':'purchase_service_lines').select('id,description,amount,tax_percent').eq('order_id',id).order('id').range(from,to)),
 supabase.from('company_settings').select('*').maybeSingle(),supabase.from('transport_service_document_balances').select('*').eq('side',side).eq('order_id',id).maybeSingle(),
 supabase.rpc('transport_document_trip_details',{p_side:side,p_order_id:id}),
 side==='customer'?supabase.from('transport_customer_documents').select('document_kind').eq('sales_order_id',id).maybeSingle():Promise.resolve({data:null,error:null})
 ]).then(([o,l,c,b,t,k])=>{for(const result of [o,c,b,t,k])if(result.error)throw result.error;if(live){setOrder(o.data);setTrips(t.data||[]);setLines(l);setCompany(c.data??{});setBalance(b.data);setCash(k.data?.document_kind==='cash_hand_bill')}}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[side,id]);
 if(error)return <p role="alert" className="text-red-700">{error}</p>;if(!order)return <p>Loading service document…</p>;
 const net=lines.reduce((sum,l)=>sum+Number(l.amount),0);const vat=lines.reduce((sum,l)=>sum+Math.round(Number(l.amount)*Number(l.tax_percent))/100,0);
 const title=side==='supplier'?'Purchase Service Invoice':cash?'Cash Hand Bill':order.invoice_type==='Tax Invoice'?'Tax Invoice':'Sales Invoice';
 return <div><div className="print:hidden"><div className="mb-3 flex items-center justify-between"><h1 className="text-lg font-semibold">{title} · {order.order_no}</h1><div className="flex gap-2"><Link className="btn" to={side==='customer'?'/sales':'/purchase'}>Back</Link>{canPrint&&<button className="btn" onClick={()=>window.print()}>Print</button>}</div></div><p>{order.party?.name} · {order.order_date} · {order.status}</p>
 <table className="my-3 w-full text-sm"><thead><tr><th className="text-left">Service</th><th className="text-right">Amount excluding VAT</th><th className="text-right">VAT</th><th className="text-right">Total</th></tr></thead><tbody>{lines.map(l=><tr key={l.id} className="border-t"><td>{l.description}</td><td className="text-right">{financialNumber(l.amount)}</td><td className="text-right">{financialNumber(Number(l.amount)*Number(l.tax_percent)/100)}</td><td className="text-right">{financialNumber(Number(l.amount)*(1+Number(l.tax_percent)/100))}</td></tr>)}</tbody></table>
 <ConfigurableReport preferenceKey={`${side}:service-invoice-trips`} report={{title:'Transport service Trip details',description:'Vehicle / Driver captured at original posting; missing history is left unattributed.',columns:['Trip','Date','From','To','Vehicle','Driver','Owner','Job / PO / DO'],rows:trips.map(t=>[t.trip_no,t.trip_date,t.from_location,t.to_location,t.vehicle_no||'Unattributed',t.driver_name||'Unattributed',t.owner_name||'',t.po_do_job_no||''])}}/>
 <p>Original posted total: {financialNumber(order.total)} · Current billed total after credits: {financialNumber(balance?.billed_gross??order.total)} · Outstanding: {financialNumber(balance?.outstanding_gross??order.outstanding_amount)} · Credit / refund: {financialNumber(balance?.credit_gross??0)}</p><p className="mt-3"><Link to="/transport" className="text-blue-700 underline">Open Trip Finance for allocation, settlement and rate adjustments</Link></p></div>
 <div className="hidden print:block">{trips.map(t=><p key={t.trip_id}>Trip {t.trip_no} · {t.trip_date} · {t.from_location} → {t.to_location} · Vehicle {t.vehicle_no||'Unattributed'} · Driver {t.driver_name||'Unattributed'} · Job {t.po_do_job_no}</p>)}<PrintLayout voucherTitle={title} voucherNo={order.order_no} voucherDate={order.order_date}
 company={{name:company.company_name,address:company.address,phone:company.phone,email:company.email,logoUrl:company.logo_url,taxId:[company.ntn,company.strn].filter(Boolean).join(' / ')}}
 party={{name:order.party?.name??'—',address:order.party?.address,phone:order.party?.phone,ntn:order.party?.ntn,strn:order.party?.strn}}
 items={lines.map(l=>({name:l.description,qty:1,unitPrice:Number(l.amount),lineTotal:Number(l.amount),taxPercent:Number(l.tax_percent),taxAmount:Math.round(Number(l.amount)*Number(l.tax_percent))/100,unit:'Service'}))}
 chargeBreakdown={[]} itemsTotal={net} chargesTotal={0} taxAmount={vat} showTaxSummary={vat>0} grandTotal={Number(order.total)}
 documentNotice="Service document. Posted source amounts remain historical; later credits and rate adjustments are separate documents."/>
 </div></div>;
}
