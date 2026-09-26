import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/auth/AuthContext";
import SearchableSelect from "@/components/SearchableSelect";
import { ErrorBanner, formatCurrency, formatDate } from "@/components/ui";
import { exportMatrixToCSV, exportMatrixToWord, exportWorkbookToExcel, triggerPrint } from "@/lib/exportUtils";
import { fetchAllPages, fetchByIdChunks } from "@/lib/fetchAllPages";

type CustomerRow={id:string;name:string;phone?:string|null;email?:string|null};
type AgingInvoice={sales_order_id:string;customer_id:string;customer_name:string|null;invoice_no:string;invoice_date:string;due_date:string|null;invoice_amount:number|string;paid_amount:number|string;outstanding_amount:number|string;payment_status:string;days_outstanding:number;overdue_days:number;aging_status:string;aging_bucket:string;invoice_type?:string|null;payment_mode?:string|null;sales_person?:string|null};
type PaymentAllocation={id:string;sales_order_id:string;journal_entry_id:string;allocation_date:string;amount:number|string;reference:string|null;notes:string|null};
const num=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;
const localIsoDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};
const docType=(raw?:string|null)=>{const v=(raw||"").trim().toLowerCase();return v==="tax invoice"||v==="with tax"?"With Tax":"Without Tax"};
const badge=(s:string)=><span className="inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold capitalize">{s||"ΓÇö"}</span>;

export default function CustomerInvoiceStatement(){
 const {activeCompany,activeBusinessUnit}=useAuth(); const companyId=activeCompany?.company_id??null; const businessUnitId=activeBusinessUnit?.business_unit_id??null;
 const [customers,setCustomers]=useState<CustomerRow[]>([]),[invoices,setInvoices]=useState<AgingInvoice[]>([]),[allocations,setAllocations]=useState<PaymentAllocation[]>([]);
 const [loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[customerSearch,setCustomerSearch]=useState(""),[selectedCustomerId,setSelectedCustomerId]=useState(""),[invoiceSearch,setInvoiceSearch]=useState("");
 const [statusFilter,setStatusFilter]=useState("all"),[agingFilter,setAgingFilter]=useState("all"),[documentFilter,setDocumentFilter]=useState("all"),[paymentModeFilter,setPaymentModeFilter]=useState("all"),[showColumns,setShowColumns]=useState(false),[expandedInvoiceId,setExpandedInvoiceId]=useState<string|null>(null);
 const [visibleColumns,setVisibleColumns]=useState({type:true,mode:true,salesperson:true,dueDate:true,age:true,overdue:true,aging:true});
 const loadReport=useCallback(async()=>{if(!companyId){setLoading(false);return}setLoading(true);setError(null);try{
 const[c,i,m,a]=await Promise.all([
  fetchAllPages<CustomerRow>((fromRow,toRow)=>
   supabase.from("customers")
    .select("id,name,phone,email")
    .eq("company_id",companyId)
    .order("name",{ascending:true})
    .order("id",{ascending:true})
    .range(fromRow,toRow)
  ),

  fetchAllPages<AgingInvoice>((fromRow,toRow)=>{
   let q=supabase
    .from("customer_invoice_aging")
    .select("*")
    .eq("company_id",companyId);

   if(businessUnitId)
     q=q.eq("business_unit_id",businessUnitId);

   return q
    .order("invoice_date",{ascending:false})
    .order("sales_order_id",{ascending:true})
    .range(fromRow,toRow);
  }),

  fetchAllPages<any>((fromRow,toRow)=>{
   let q=supabase
    .from("sales_orders")
    .select("id,invoice_type,payment_mode,sales_person")
    .eq("company_id",companyId);

   if(businessUnitId)
     q=q.eq("business_unit_id",businessUnitId);

   return q.order("id",{ascending:true}).range(fromRow,toRow);
  }),

  fetchAllPages<PaymentAllocation>((fromRow,toRow)=>{
   let q=supabase
    .from("invoice_payment_allocations")
    .select("id,sales_order_id,journal_entry_id,allocation_date,amount,reference,notes")
    .eq("company_id",companyId);

   if(businessUnitId)
     q=q.eq("business_unit_id",businessUnitId);

   return q
    .order("allocation_date",{ascending:false})
    .order("id",{ascending:true})
    .range(fromRow,toRow);
  })
 ]);

 setCustomers(c);

 const meta=new Map(m.map((r:any)=>[r.id,r]));

 setInvoices(
   i.map(r=>({...r,...(meta.get(r.sales_order_id)??{})}))
 );

 setAllocations(a);

}catch(err){
 setError(
   err instanceof Error
    ? err.message
    : "Unable to load customer invoice statement."
 );
 setCustomers([]);
 setInvoices([]);
 setAllocations([]);
}setLoading(false)},[companyId,businessUnitId]);
 useEffect(()=>{void loadReport()},[loadReport]);
 const selectedCustomer=useMemo(()=>customers.find(c=>c.id===selectedCustomerId)??null,[customers,selectedCustomerId]);
 const customerMatches=useMemo(()=>{const q=customerSearch.trim().toLowerCase();return(!q?customers:customers.filter(c=>c.name.toLowerCase().includes(q))).slice(0,50)},[customers,customerSearch]);
 const baseFiltered=useMemo(()=>{const q=invoiceSearch.trim().toLowerCase();return invoices.filter(x=>(!selectedCustomerId||x.customer_id===selectedCustomerId)&&(statusFilter==="all"||(x.payment_status||"").toLowerCase()===statusFilter)&&(documentFilter==="all"||docType(x.invoice_type)===documentFilter)&&(paymentModeFilter==="all"||(x.payment_mode||"Credit")===paymentModeFilter)&&(!q||[x.invoice_no,x.invoice_date,x.due_date,x.customer_name,x.payment_status,x.aging_status,x.aging_bucket,x.sales_person].join(" ").toLowerCase().includes(q)))},[invoices,selectedCustomerId,statusFilter,documentFilter,paymentModeFilter,invoiceSearch]);
 const filtered=useMemo(()=>baseFiltered.filter(x=>agingFilter==="all"||x.aging_bucket===agingFilter),[baseFiltered,agingFilter]);
 const summary=useMemo(()=>filtered.reduce((a,x)=>{a.invoiced+=num(x.invoice_amount);a.received+=num(x.paid_amount);a.outstanding+=num(x.outstanding_amount);if(num(x.overdue_days)>0&&num(x.outstanding_amount)>0)a.overdue+=num(x.outstanding_amount);return a},{invoiced:0,received:0,outstanding:0,overdue:0}),[filtered]);
 const buckets=useMemo(()=>{const t:Record<string,number>={Current:0,"1-30 Days":0,"31-60 Days":0,"61-90 Days":0,"90+ Days":0};baseFiltered.forEach(x=>{if(x.aging_bucket in t)t[x.aging_bucket]+=num(x.outstanding_amount)});return t},[baseFiltered]);
 const invoiceRows=useMemo(()=>[["Customer","Invoice No","Invoice Date","Document Type","Payment Mode","Salesperson","Due Date","Invoice Amount","Received","Balance Due","Payment Status","Invoice Age Days","Overdue Days","Aging Bucket","Aging Status"],...filtered.map(x=>[x.customer_name||"",x.invoice_no,x.invoice_date,docType(x.invoice_type),x.payment_mode||"Credit",x.sales_person||"",x.due_date||"",num(x.invoice_amount),num(x.paid_amount),num(x.outstanding_amount),x.payment_status,num(x.days_outstanding),num(x.overdue_days),x.aging_bucket,x.aging_status])],[filtered]);
 const paymentRows=useMemo(()=>{const ids=new Set(filtered.map(x=>x.sales_order_id));const inv=new Map(filtered.map(x=>[x.sales_order_id,x]));return [["Customer","Invoice No","Payment Date","Amount","Reference","Notes","Journal Entry"],...allocations.filter(a=>ids.has(a.sales_order_id)).map(a=>{const x=inv.get(a.sales_order_id);return[x?.customer_name||"",x?.invoice_no||"",a.allocation_date,num(a.amount),a.reference||"",a.notes||"",a.journal_entry_id]})]},[filtered,allocations]);
 const filterRows=useMemo(()=>[["Report","Customer Invoice Statement & Aging"],["Company",activeCompany?.company_name||""],["Customer",selectedCustomer?.name||"All Customers"],["Payment Status",statusFilter==="all"?"All Statuses":statusFilter],["Aging Bucket",agingFilter==="all"?"All Aging":agingFilter],["Document Type",documentFilter==="all"?"All Documents":documentFilter],["Payment Mode",paymentModeFilter==="all"?"All Payment Modes":paymentModeFilter],["Search",invoiceSearch||"ΓÇö"],["Export Date",localIsoDate()]],[activeCompany,selectedCustomer,statusFilter,agingFilter,documentFilter,paymentModeFilter,invoiceSearch]);
 const summaryRows=useMemo(()=>[["Metric","Amount"],["Total Invoiced",summary.invoiced],["Total Received",summary.received],["Outstanding",summary.outstanding],["Overdue Amount",summary.overdue],[""],["Aging Bucket","Amount"],...Object.entries(buckets)],[summary,buckets]);
 const completeRows=useMemo(()=>[["CUSTOMER INVOICE STATEMENT & AGING"],[""],...filterRows,[""],["SUMMARY"],...summaryRows,[""],["INVOICE-WISE STATEMENT"],...invoiceRows,[""],["PAYMENT ALLOCATIONS"],...paymentRows],[filterRows,summaryRows,invoiceRows,paymentRows]);
 const fileName=`${selectedCustomer?.name?.replace(/\s+/g,"_")||"Customer_Aging"}_${localIsoDate()}`;
 const exportExcel=()=>exportWorkbookToExcel(fileName,[{name:"Summary & Filters",rows:[...filterRows,[""],...summaryRows]},{name:"Invoice Detail",rows:invoiceRows},{name:"Payment Allocations",rows:paymentRows}]);
 const clearCustomer=()=>{setSelectedCustomerId("");setCustomerSearch("");setExpandedInvoiceId(null)};
 return <div className="space-y-4 print-report" data-print-root>
  <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between print:hidden"><div><h1 className="text-2xl font-bold">Customer Invoice Statement & Aging</h1><p className="mt-1 text-sm text-slate-500">Company-wide receivables, payment history, outstanding balances and aging. Customer is an optional filter.</p></div><div className="relative flex flex-wrap gap-2"><button className="btn-secondary" onClick={()=>setShowColumns(v=>!v)}>Customize</button>{showColumns&&<div className="absolute right-0 top-11 z-50 w-80 rounded-lg border bg-white p-3 shadow-xl"><div className="mb-2 flex justify-between"><strong>Show / Hide Columns</strong><button onClick={()=>setShowColumns(false)}>Γ£ò</button></div>{Object.entries({type:"Document Type",mode:"Payment Mode",salesperson:"Salesperson",dueDate:"Due Date",age:"Invoice Age",overdue:"Overdue",aging:"Aging Bucket"}).map(([k,l])=><label key={k} className="mr-3 block text-xs"><input type="checkbox" checked={visibleColumns[k as keyof typeof visibleColumns]} onChange={()=>setVisibleColumns(v=>({...v,[k]:!v[k as keyof typeof v]}))}/> {l}</label>)}<button className="btn-secondary mt-2 w-full" onClick={()=>setVisibleColumns({type:true,mode:true,salesperson:true,dueDate:true,age:true,overdue:true,aging:true})}>Show All</button></div>}<button className="btn-secondary" onClick={exportExcel}>Excel</button><button className="btn-secondary" onClick={()=>exportMatrixToCSV(fileName,completeRows)}>CSV</button><button className="btn-secondary" onClick={()=>exportMatrixToWord(fileName,completeRows,"Customer Invoice Statement & Aging")}>Word</button><button className="btn-secondary" onClick={()=>triggerPrint("[data-print-root]")}>Print / PDF</button></div></div>
  {error&&<ErrorBanner message={error}/>}<div className="rounded-xl border bg-white p-4 print:hidden" data-report-filters><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5"><div className="relative"><label className="label">Customer</label><input className="input" value={customerSearch} onChange={e=>{setCustomerSearch(e.target.value);if(selectedCustomerId)setSelectedCustomerId("")}} placeholder="All customers"/>{!selectedCustomerId&&customerSearch.trim()&&<div className="absolute z-40 mt-1 w-full rounded-lg border bg-white shadow">{customerMatches.map(c=><button key={c.id} className="block w-full p-2 text-left" onClick={()=>{setSelectedCustomerId(c.id);setCustomerSearch(c.name)}}>{c.name}</button>)}</div>}{(customerSearch||selectedCustomerId)&&<button className="text-xs" onClick={clearCustomer}>Clear</button>}</div><div><label className="label">Payment Status</label><SearchableSelect className="input" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">All Statuses</option><option value="unpaid">Unpaid</option><option value="partial">Partial</option><option value="paid">Paid</option><option value="overdue">Overdue</option></SearchableSelect></div><div><label className="label">Aging Bucket</label><SearchableSelect className="input" value={agingFilter} onChange={e=>setAgingFilter(e.target.value)}><option value="all">All Aging</option>{Object.keys(buckets).map(x=><option key={x}>{x}</option>)}</SearchableSelect></div><div><label className="label">Document Type</label><SearchableSelect className="input" value={documentFilter} onChange={e=>setDocumentFilter(e.target.value)}><option value="all">All Documents</option><option>Without Tax</option><option>With Tax</option></SearchableSelect></div><div><label className="label">Payment Mode</label><SearchableSelect className="input" value={paymentModeFilter} onChange={e=>setPaymentModeFilter(e.target.value)}><option value="all">All Payment Modes</option><option>Credit</option><option>Cash</option><option>Bank</option><option>Partial</option></SearchableSelect></div></div><input className="input mt-4" value={invoiceSearch} onChange={e=>setInvoiceSearch(e.target.value)} placeholder="Search customer, invoice no., date, payment status, salesperson or aging..."/></div>
  <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-export-summary>{[["Total Invoiced",summary.invoiced],["Total Received",summary.received],["Outstanding",summary.outstanding],["Overdue Amount",summary.overdue]].map(([l,v])=><div key={String(l)} className="rounded-xl border bg-white p-4"><div className="text-sm text-slate-500" data-summary-label>{l}</div><div className="mt-1 text-xl font-bold" data-summary-value>{formatCurrency(Number(v))}</div></div>)}</div>
  <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Object.entries(buckets).map(([l,v])=><button key={l} onClick={()=>setAgingFilter(l)} className="rounded-xl border bg-white p-3 text-left"><div className="text-sm text-slate-500">{l}</div><b>{formatCurrency(v)}</b></button>)}</div>
  <div className="overflow-hidden rounded-xl border bg-white"><div className="flex justify-between border-b p-4"><div><h3 className="font-bold">Invoice-wise Statement</h3><p className="text-xs text-slate-500">Click a row to see payments allocated against that invoice.</p></div><span>{loading?"Loading...":`${filtered.length} invoices`}</span></div><div className="overflow-x-auto"><table className="w-full min-w-[1400px] text-sm"><thead><tr><th>Customer</th><th>Invoice #</th><th>Invoice Date</th>{visibleColumns.type&&<th>Document Type</th>}{visibleColumns.mode&&<th>Payment Mode</th>}{visibleColumns.salesperson&&<th>Salesperson</th>}{visibleColumns.dueDate&&<th>Due Date</th>}<th>Invoice</th><th>Received</th><th>Balance Due</th><th>Payment</th>{visibleColumns.age&&<th>Invoice Age</th>}{visibleColumns.overdue&&<th>Overdue</th>}{visibleColumns.aging&&<th>Aging Bucket</th>}</tr></thead><tbody>{!filtered.length?<tr><td colSpan={14} className="p-8 text-center text-slate-500">No invoices match the current filters.</td></tr>:filtered.map(x=>{const open=expandedInvoiceId===x.sales_order_id;const pays=allocations.filter(a=>a.sales_order_id===x.sales_order_id);return <><tr key={x.sales_order_id} className="cursor-pointer border-t" onClick={()=>setExpandedInvoiceId(open?null:x.sales_order_id)}><td>{x.customer_name}</td><td>{x.invoice_no}</td><td>{formatDate(x.invoice_date)}</td>{visibleColumns.type&&<td>{docType(x.invoice_type)}</td>}{visibleColumns.mode&&<td>{x.payment_mode||"Credit"}</td>}{visibleColumns.salesperson&&<td>{x.sales_person||"ΓÇö"}</td>}{visibleColumns.dueDate&&<td>{x.due_date?formatDate(x.due_date):"ΓÇö"}</td>}<td>{formatCurrency(num(x.invoice_amount))}</td><td>{formatCurrency(num(x.paid_amount))}</td><td>{formatCurrency(num(x.outstanding_amount))}</td><td>{badge(x.payment_status)}</td>{visibleColumns.age&&<td>{num(x.days_outstanding)} days</td>}{visibleColumns.overdue&&<td>{num(x.overdue_days)} days</td>}{visibleColumns.aging&&<td>{x.aging_bucket}</td>}</tr>{open&&<tr key={`${x.sales_order_id}-p`}><td colSpan={14} className="bg-slate-50 p-4">{pays.length?pays.map(p=><div key={p.id}>{formatDate(p.allocation_date)} ΓÇö {formatCurrency(num(p.amount))} ΓÇö {p.reference||"ΓÇö"}</div>):"No payment allocations found."}</td></tr>}</>})}</tbody></table></div></div>
 </div>
}
