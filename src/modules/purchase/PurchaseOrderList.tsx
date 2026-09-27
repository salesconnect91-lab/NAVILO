import { useCallback, useEffect, useMemo, useState } from "react";
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
  const { activeCompany, isPlatformOwner } = useAuth();
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

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const [ordersRes, linksRes] = await Promise.all([
      supabase.from("purchase_orders").select("*, supplier:suppliers(*)").order("created_at", { ascending: false }),
      supabase.from("purchase_order_consolidated_invoices").select("purchase_order_id,consolidated_invoice:consolidated_purchase_invoices(invoice_no)"),
    ]);
    const loadError = ordersRes.error || linksRes.error;
    if (loadError) setError(loadError.message);
    else {
      setRows((ordersRes.data ?? []) as PurchaseOrder[]);
      const links: Record<string, string[]> = {};
      for (const link of linksRes.data ?? []) {
        const invoice = Array.isArray((link as any).consolidated_invoice) ? (link as any).consolidated_invoice[0] : (link as any).consolidated_invoice;
        if (!invoice?.invoice_no) continue;
        (links[(link as any).purchase_order_id] ||= []).push(invoice.invoice_no);
      }
      setConsolidatedLinks(links);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void fetchRows(); }, [fetchRows]);

  const deleteDraft = async (row: PurchaseOrder) => {
    if (String(row.status).toLowerCase() !== "draft") return;
    if (!window.confirm(`Delete draft Purchase Invoice ${row.order_no}?`)) return;
    setError(null);
    const { data: deleted, error: deleteError } = await supabase.rpc("delete_draft_purchase_invoice", { p_order_id: row.id });
    if (deleteError) { setError(deleteError.message); return; }
    if (!deleted) { setError("Draft Purchase Invoice could not be deleted. Refresh and try again."); return; }
    await fetchRows();
  };

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      const invoiceType = row.invoice_type === "Tax Invoice" ? "with-tax" : "without-tax";
      const matchesSearch = !q || [row.order_no, row.supplier?.name ?? "", row.status ?? "", row.invoice_type ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q);
      const matchesType = typeFilter === "all" || typeFilter === invoiceType;
      const matchesStatus = statusFilter === "all" || String(row.status ?? "").toLowerCase() === statusFilter;
      const rowPayment = String(row.payment_status ?? "unpaid").toLowerCase();
      const matchesPayment = paymentFilter === "all" || rowPayment === paymentFilter;
      const matchesFrom = !fromDate || String(row.order_date || "") >= fromDate;
      const matchesTo = !toDate || String(row.order_date || "") <= toDate;
      return matchesSearch && matchesType && matchesStatus && matchesPayment && matchesFrom && matchesTo;
    });
  }, [rows, search, typeFilter, statusFilter, paymentFilter, fromDate, toDate]);

  const visiblePurchaseTotal = useMemo(
    () => filteredRows.reduce((sum, row) => sum + (Number(row.total) || 0), 0),
    [filteredRows],
  );
  const visiblePostedTotal = useMemo(
    () => filteredRows.reduce((sum, row) => String(row.status ?? "").toLowerCase() === "posted" ? sum + (Number(row.total) || 0) : sum, 0),
    [filteredRows],
  );

  const paymentBadge = (row: PurchaseOrder) => {
    const status = String(row.payment_status ?? "unpaid").toLowerCase();
    const label = status === "paid" ? "Paid" : status === "partial" ? "Partially Paid" : status === "overpaid" ? "Overpaid" : "Unpaid";
    const cls = status === "paid" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : status === "partial" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-rose-200 bg-rose-50 text-rose-700";
    return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
  };
  const visibleBalance = useMemo(() => filteredRows.reduce((sum, row) => sum + (Number(row.outstanding_amount ?? row.total) || 0), 0), [filteredRows]);
  const visibleSuppliers = useMemo(() => new Set(filteredRows.map((row) => row.supplier_id).filter(Boolean)).size, [filteredRows]);

  const columns: Column<PurchaseOrder>[] = [
    { key: "order_no", label: "Purchase Invoice #", sortable: true, render: (r) => <span className="font-semibold text-blue-600">{r.order_no}</span> },
    { key: "consolidated", label: "Consolidated Purchase #", render: (r) => consolidatedLinks[r.id]?.length ? <div className="flex flex-wrap gap-1">{consolidatedLinks[r.id].map((no) => <span key={no} className="font-semibold text-violet-700">{no}</span>)}</div> : <span className="text-slate-400">—</span> },
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
    <div className="navilo-purchase-neus space-y-3" data-navilo-commercial-standard="true">
      <PageHeader
        title="Purchase Invoices"
        subtitle="Supplier invoices, payables and posting"
        action={<div className="flex flex-wrap items-center gap-2">
          {canCreate && <button onClick={() => navigate("/purchase/new")} className="btn-primary">+ New Purchase Invoice</button>}
          <span data-navilo-standard-tools-host className="contents" />
        </div>}
      />

      <div className="grid gap-3 md:grid-cols-4" data-no-export>
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"><span className="rounded-full bg-blue-50 p-2 text-blue-600"><FileText className="h-5 w-5"/></span><div><div className="text-xs text-slate-600">Visible Invoices</div><div className="font-bold">{filteredRows.length}</div></div></div>
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"><span className="rounded-full bg-emerald-50 p-2 text-emerald-600"><Landmark className="h-5 w-5"/></span><div><div className="text-xs text-slate-600">Purchase Total</div><div className="font-bold">{formatCurrency(visiblePurchaseTotal)}</div></div></div>
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"><span className="rounded-full bg-rose-50 p-2 text-rose-600"><Clock3 className="h-5 w-5"/></span><div><div className="text-xs text-slate-600">Balance Due</div><div className="font-bold text-rose-600">{formatCurrency(visibleBalance)}</div></div></div>
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"><span className="rounded-full bg-violet-50 p-2 text-violet-600"><Truck className="h-5 w-5"/></span><div><div className="text-xs text-slate-600">Suppliers</div><div className="font-bold">{visibleSuppliers}</div></div></div>
      </div>

      <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 lg:grid-cols-[minmax(260px,1fr)_150px_175px_175px_150px_150px_auto]" data-no-export data-no-print>
        <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice, supplier or status..." />
        <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option value="all">All Types</option><option value="without-tax">Without Tax</option><option value="with-tax">With Tax</option></select>
        <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">All posting statuses</option><option value="draft">Draft</option><option value="posted">Posted</option><option value="cancelled">Cancelled</option></select>
        <select className="input" value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)}><option value="all">All payment statuses</option><option value="unpaid">Unpaid</option><option value="partial">Partially Paid</option><option value="paid">Paid</option></select>
        <label className="text-[11px] font-semibold text-slate-600">From Date<input type="date" className="input mt-1" value={fromDate} onChange={(e) => setFromDate(e.target.value)}/></label>
        <label className="text-[11px] font-semibold text-slate-600">To Date<input type="date" className="input mt-1" value={toDate} onChange={(e) => setToDate(e.target.value)}/></label>
        {(search || typeFilter !== "all" || statusFilter !== "all" || paymentFilter !== "all" || fromDate || toDate) && <button className="btn-secondary self-end" onClick={() => { setSearch(""); setTypeFilter("all"); setStatusFilter("all"); setPaymentFilter("all"); setFromDate(""); setToDate(""); }}><RotateCcw className="h-4 w-4"/>Clear</button>}
      </div>

      {error && <ErrorBanner message={error} />}
      <div data-report-content data-navilo-customizable="true" data-navilo-print-surface className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3"><h2 className="text-sm font-bold text-slate-900">Purchase Invoices <span className="text-slate-500">({filteredRows.length})</span></h2></div>
        <DataTable columns={columns} rows={filteredRows} loading={loading} emptyMessage="No Main Purchase Invoices found." showSerialNumber />
      </div>
    </div>
  );
}
