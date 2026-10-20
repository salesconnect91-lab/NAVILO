import TransportOpeningInvoices from '../transport/TransportOpeningInvoices';
import NaviloSearchableSelect from "@/components/SearchableSelect";
import NaviloDateInput from '@/components/NaviloDateInput';
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { PurchaseOrder } from "@/types";
import DataTable, { Column } from "@/components/DataTable";
import { PageHeader, ErrorBanner, StatusBadge, formatCurrency, formatDate } from "@/components/ui";
import { useAuth } from "@/auth/AuthContext";
import { canPerformModule } from "@/auth/permissions";
import { Clock3, FileText, Landmark, RotateCcw, Truck } from "lucide-react";

type ImportRow = {
  invoice_no?: string;
  supplier?: string;
  invoice_date?: string;
  invoice_type?: string;
  item?: string;
  description?: string;
  godown?: string;
  qty?: string | number;
  unit_cost?: string | number;
  tax_percent?: string | number;
};

type ImportSupplier = { id: string; name: string };
type ImportItem = { id: string; name: string; sku?: string | null };
type ImportGodown = { id: string; name: string };

const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase();
const importInvoiceType = (value: unknown) => {
  const v = normalize(value);
  return v === "with tax" || v === "tax invoice" || v === "with-tax" ? "Tax Invoice" : "Purchase Invoice";
};

export default function PurchaseOrderList() {
  const navigate = useNavigate();
  const { activeCompany, activeBusinessUnit, isPlatformOwner } = useAuth();
  const canCreate = canPerformModule(activeCompany?.membership_role, "purchase", "create", activeCompany?.permissions, isPlatformOwner);
  const canDelete = canPerformModule(activeCompany?.membership_role, "purchase", "delete", activeCompany?.permissions, isPlatformOwner);
    const [rows, setRows] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [consolidatedLinks, setConsolidatedLinks] = useState<Record<string, string[]>>({});
  const [listPage,setListPage]=useState(1);
  const [listPageSize,setListPageSize]=useState(25);
  const [listSort,setListSort]=useState<{key:string;dir:"asc"|"desc"}|null>(null);
  const [listSummary,setListSummary]=useState({count:0,total:0,balance:0,parties:0});
  const [listReadFailed,setListReadFailed]=useState(false);
  const listRequest=useRef(0);

  const fetchRows=useCallback(async()=>{
    const request=++listRequest.current;
    setLoading(true);setError(null);
    try{
      const {data,error:readError}=await supabase.rpc("commercial_invoice_list_query",{
        p_side:"purchase",p_search:search,p_status:statusFilter,p_payment:paymentFilter,
        p_type:typeFilter,p_from:fromDate||null,p_to:toDate||null,
        p_sort:listSort?.key??"created_at",p_desc:listSort?listSort.dir==="desc":true,
        p_limit:listPageSize,p_offset:(listPage-1)*listPageSize
      });
      if(readError)throw readError;
      const pageRows=(data?.rows??[]) as PurchaseOrder[];
      const ids=pageRows.map(row=>row.id);
      const needsConsolidated=pageRows.some(row=>(row as PurchaseOrder & {document_kind?:string|null}).document_kind!=='service');
      const linked=ids.length&&needsConsolidated?await supabase.from("purchase_order_consolidated_invoices")
        .select("purchase_order_id,consolidated_invoice:consolidated_purchase_invoices(invoice_no)")
        .in("purchase_order_id",ids):null;
      // Consolidated links are optional supplementary metadata, not a prerequisite
      // to show canonical Purchase invoices. They can be disabled for Transport.
      // Keep invoice rows visible if this read is denied or unavailable.
      if(linked?.error)console.warn('Purchase consolidated reference lookup unavailable:',linked.error.message);
      if(request!==listRequest.current)return;
      const numbers:Record<string,string[]>={};
      for(const link of (linked?.error ? [] : linked?.data ?? [])){
        const invoice=Array.isArray((link as any).consolidated_invoice)
          ?(link as any).consolidated_invoice[0]:(link as any).consolidated_invoice;
        if(invoice?.invoice_no)(numbers[(link as any).purchase_order_id]??=[]).push(invoice.invoice_no);
      }
      setRows(pageRows);setConsolidatedLinks(numbers);
      setListReadFailed(false);
      setListSummary({count:Number(data?.count??0),total:Number(data?.total??0),
        balance:Number(data?.balance??0),parties:Number(data?.parties??0)});
    }catch(e:any){
      if(request===listRequest.current){setListReadFailed(true);setError(e?.message??"Unable to read Purchase invoices. Retry.");}
    }finally{
      if(request===listRequest.current)setLoading(false);
    }
  },[search,typeFilter,statusFilter,paymentFilter,fromDate,toDate,listSort,listPage,listPageSize,activeCompany?.company_id]);

  useEffect(()=>{
    const timer=window.setTimeout(()=>void fetchRows(),250);
    return()=>{window.clearTimeout(timer);listRequest.current++};
  },[fetchRows]);
  useEffect(()=>{setListPage(1)},[search,typeFilter,statusFilter,paymentFilter,fromDate,toDate,listSort]);

  const deleteDraft = async (row: PurchaseOrder) => {
    if (String(row.status).toLowerCase() !== "draft") return;
    if (!window.confirm(`Delete draft Purchase Invoice ${row.order_no}?`)) return;
    setError(null);
    const { data: deleted, error: deleteError } = await supabase.rpc("delete_draft_purchase_invoice", { p_order_id: row.id });
    if (deleteError) { setError(deleteError.message); return; }
    if (!deleted) { setError("Draft Purchase Invoice could not be deleted. Refresh and try again."); return; }
    await fetchRows();
  };

  // Whole-result filtering is done by the database.
  const filteredRows=rows;

  const visiblePurchaseTotal=listSummary.total;

  const paymentBadge = (row: PurchaseOrder) => {
    const status = String(row.payment_status ?? "unpaid").toLowerCase();
    const label = status === "paid" ? "Paid" : status === "partial" ? "Partially Paid" : status === "overpaid" ? "Overpaid" : "Unpaid";
    const cls = status === "paid" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : status === "partial" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-rose-200 bg-rose-50 text-rose-700";
    return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
  };
  const visibleBalance=listSummary.balance;
  const visibleSuppliers=listSummary.parties;

  const columns: Column<PurchaseOrder>[] = [
    { key: "order_no", label: "Purchase Invoice #", sortable: true, render: (r) => <span className="font-semibold text-blue-600" title={r.order_no}>{(r as PurchaseOrder & {display_invoice_no?: string | null}).display_invoice_no || "0"}</span> },
    { key: "supplier", label: "Supplier", render: (r) => r.supplier?.name ?? "—" },
    { key: "order_date", label: "Invoice Date", sortable: true, render: (r) => formatDate(r.order_date) },
    { key: "invoice_type", label: "Type", sortable: true, render: (r) => r.invoice_type === "Tax Invoice" ? <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700">With Tax</span> : <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">Without Tax</span> },
    { key: "status", label: "Posting", sortable: true, render: (r) => <StatusBadge status={r.status} /> },
    { key: "payment_status", label: "Payment Status", sortable: true, render: paymentBadge },
    { key: "total", label: "Invoice Amount", sortable: true, className: "text-right", render: (r) => <span className="font-semibold">{formatCurrency(r.total)}</span> },
    { key: "outstanding_amount", label: "Balance Due", sortable: true, className: "text-right", render: (r) => <span className="font-semibold text-rose-600">{formatCurrency(Number(r.outstanding_amount ?? r.total) || 0)}</span> },
    { key: "actions", label: "Actions", className: "text-right", render: (r) => {
      const isDraft = String(r.status ?? "").toLowerCase() === "draft";
      return <div className="flex justify-end gap-2">
        <button className="font-semibold text-blue-600 hover:text-blue-800" onClick={() => navigate(`/purchase/${r.id}`)}>Open →</button>
        {isDraft && canDelete && <button className="text-xs font-semibold text-rose-600" onClick={() => void deleteDraft(r)}>Delete</button>}
      </div>;
    }},
  ];

  return (
    <div className="navilo-purchase-neus min-w-0 max-w-full space-y-3" data-navilo-commercial-standard="true">
      <PageHeader
        title="Purchase Invoices"
        subtitle="Supplier invoices, payables and posting"
        action={<div className="flex flex-wrap items-center gap-2">
          {canCreate && activeBusinessUnit?.business_unit_type==='transport'&&<><button type="button" onClick={() => navigate("/purchase/new?type=service")} className="btn-primary" aria-label="Create Trip Service Purchase Invoice">+ Service Purchase Invoice (Trips)</button><button type="button" onClick={() => navigate("/purchase/new?type=normal")} className="btn border border-blue-300 bg-blue-50 text-blue-800" aria-label="Create Normal Purchase Invoice">+ Purchase Invoice (Normal)</button></>}{canCreate && activeBusinessUnit?.business_unit_type!=='transport' && <button onClick={() => navigate("/purchase/new")} className="btn-primary">+ New Purchase Invoice</button>}
          {canCreate && activeBusinessUnit?.business_unit_type!=="transport" && <button type="button" onClick={()=>navigate("/purchase/expense/new")} className="btn border border-emerald-300 bg-emerald-50 text-emerald-900">+ Expense Invoice</button>}
          {canCreate && <button type="button" onClick={()=>navigate("/purchase/expense/import")} className="btn">{activeBusinessUnit?.business_unit_type==="transport"?"Import General Expenses":"Import Expenses"}</button>}
          <span data-navilo-standard-tools-host className="contents" />
        </div>}
      />

      {activeBusinessUnit?.business_unit_type==="transport"&&<div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700" role="note"><strong>Which purchase entry?</strong> Trip supplier rent → <button type="button" className="font-semibold text-blue-700 underline" onClick={()=>navigate("/purchase/new?type=service")}>Service Purchase (Trips)</button>. Fuel, repair or non-trip supplier bill → <button type="button" className="font-semibold text-blue-700 underline" onClick={()=>navigate("/purchase/new?type=normal")}>Normal Purchase</button> (choose vehicle per line). A supplier payment settles the posted payable; it does not create another expense. For direct cash expenses without an invoice, use an accounting Journal Entry. Do not enter one expense twice.</div>}
      <TransportOpeningInvoices side="supplier"/>
      <div className="grid gap-3 md:grid-cols-4" data-no-export>
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"><span className="rounded-full bg-blue-50 p-2 text-blue-600"><FileText className="h-5 w-5"/></span><div><div className="text-xs text-slate-600">Filtered Invoices</div><div className="font-bold">{listReadFailed ? '—' : listSummary.count}</div></div></div>
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"><span className="rounded-full bg-emerald-50 p-2 text-emerald-600"><Landmark className="h-5 w-5"/></span><div><div className="text-xs text-slate-600">Purchase Total</div><div className="font-bold">{listReadFailed ? '—' : formatCurrency(visiblePurchaseTotal)}</div></div></div>
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"><span className="rounded-full bg-rose-50 p-2 text-rose-600"><Clock3 className="h-5 w-5"/></span><div><div className="text-xs text-slate-600">Balance Due</div><div className="font-bold text-rose-600">{listReadFailed ? '—' : formatCurrency(visibleBalance)}</div></div></div>
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"><span className="rounded-full bg-violet-50 p-2 text-violet-600"><Truck className="h-5 w-5"/></span><div><div className="text-xs text-slate-600">Suppliers</div><div className="font-bold">{listReadFailed ? '—' : visibleSuppliers}</div></div></div>
      </div>

      <div className="grid min-w-0 max-w-full grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_minmax(120px,150px)_minmax(145px,175px)_minmax(145px,175px)_minmax(135px,150px)_minmax(135px,150px)_auto]" data-no-export data-no-print>
        <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice, supplier or status..." />
        <NaviloSearchableSelect nativeCompatibility preserveLabel className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option value="all">All Types</option><option value="without-tax">Without Tax</option><option value="with-tax">With Tax</option></NaviloSearchableSelect>
        <NaviloSearchableSelect nativeCompatibility preserveLabel className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">All posting statuses</option><option value="draft">Draft</option><option value="posted">Posted</option><option value="cancelled">Cancelled</option></NaviloSearchableSelect>
        <NaviloSearchableSelect nativeCompatibility preserveLabel className="input" value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}><option value="all">All payment statuses</option><option value="unpaid">Unpaid</option><option value="partial">Partially Paid</option><option value="paid">Paid</option></NaviloSearchableSelect>
        <label className="min-w-0 text-[11px] font-semibold text-slate-600">From Date<NaviloDateInput type="date" className="input mt-1 min-w-0 max-w-full" value={fromDate} onChange={(e) => setFromDate(e.target.value)}/></label>
        <label className="min-w-0 text-[11px] font-semibold text-slate-600">To Date<NaviloDateInput type="date" className="input mt-1 min-w-0 max-w-full" value={toDate} onChange={(e) => setToDate(e.target.value)}/></label>
        {(search || typeFilter !== "all" || statusFilter !== "all" || paymentFilter !== "all" || fromDate || toDate) && <button className="btn-secondary self-end" onClick={() => { setSearch(""); setTypeFilter("all"); setStatusFilter("all"); setPaymentFilter("all"); setFromDate(""); setToDate(""); }}><RotateCcw className="h-4 w-4"/>Clear</button>}
      </div>

      {error && <div className="flex items-center gap-2"><ErrorBanner message={error}/><button type="button" className="btn-secondary" onClick={()=>void fetchRows()}>Retry invoices</button></div>}
      <div data-report-content data-navilo-customizable="true" data-navilo-print-surface className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3"><h2 className="text-sm font-bold text-slate-900">Purchase Invoices <span className="text-slate-500">({listReadFailed ? '—' : listSummary.count})</span></h2></div>
        {listReadFailed && <p role="status" className="mx-3 mt-2 text-xs font-semibold text-amber-800">Invoice query failed. Rows shown may be from the last successful filter; totals and counts are unavailable until Retry succeeds.</p>}
        <DataTable columns={columns} rows={filteredRows} loading={loading} emptyMessage={error?"Query failed; retry Purchase invoices.":"No Main Purchase Invoices found."} showSerialNumber remote={{total:listSummary.count,page:listPage,pageSize:listPageSize,onPageChange:(page,pageSize)=>{setListPage(page);setListPageSize(pageSize)},sort:listSort,onSortChange:sort=>setListSort(sort)}} />
      </div>
    </div>
  );
}
