import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { PurchaseOrder } from "@/types";
import DataTable, { Column } from "@/components/DataTable";
import { PageHeader, ErrorBanner, StatusBadge, formatCurrency, formatDate } from "@/components/ui";
import { useAuth } from "@/auth/AuthContext";
import { canPerformModule } from "@/auth/permissions";

export default function PurchaseOrderList() {
  const navigate = useNavigate();
  const { activeCompany, isPlatformOwner } = useAuth();
  const canCreate = canPerformModule(activeCompany?.membership_role, "purchase", "create", activeCompany?.permissions, isPlatformOwner);
  const [rows, setRows] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from("purchase_orders")
      .select("*, supplier:suppliers(*)")
      .order("created_at", { ascending: false });
    if (loadError) setError(loadError.message);
    else setRows(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void fetchRows(); }, [fetchRows]);

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
      return matchesSearch && matchesType && matchesStatus;
    });
  }, [rows, search, typeFilter, statusFilter]);

  const columns: Column<PurchaseOrder>[] = [
    { key: "order_no", label: "Invoice # / انوائس", render: (r) => <span className="font-medium text-primary-600">{r.order_no}</span> },
    { key: "supplier", label: "Supplier / سپلائر", render: (r) => r.supplier?.name ?? "—" },
    { key: "order_date", label: "Date / تاریخ", render: (r) => formatDate(r.order_date) },
    { key: "invoice_type", label: "Type / قسم", render: (r) => r.invoice_type === "Tax Invoice" ? "With Tax / ٹیکس کے ساتھ" : "Without Tax / بغیر ٹیکس" },
    { key: "status", label: "Status / حالت", render: (r) => <StatusBadge status={r.status} /> },
    { key: "total", label: "Total / کل", render: (r) => <span className="font-medium">{formatCurrency(r.total)}</span> },
    { key: "actions", label: "", className: "text-right", render: (r) => <button onClick={() => navigate(`/purchase/${r.id}`)} className="text-primary-600 hover:text-primary-700 text-sm font-medium">Open →</button> },
  ];

  return (
    <div>
      <PageHeader
        title="Purchase Invoices / خریداری انوائسز"
        subtitle="Supplier invoices, tax status and consolidated receiving workflow"
        action={(
          <div className="flex flex-wrap items-center gap-2">
            <span data-navilo-standard-tools-host className="contents" />
            {canCreate && <button onClick={() => navigate("/purchase/consolidated")} className="btn-secondary">Consolidated Purchase / کنسولیڈیٹڈ</button>}
            {canCreate && <button onClick={() => navigate("/purchase/new")} className="btn-primary">+ Main Purchase Invoice</button>}
          </div>
        )}
      />

      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600" data-no-export data-no-print>
        <strong>Main Purchase Invoice</strong> is the supplier/accounting invoice. <strong>Consolidated Purchase</strong> stays separate, receives stock first, and can be added later to a Main Purchase Invoice without receiving the same stock twice.
      </div>

      <div className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-[minmax(0,1fr)_180px_180px_auto]" data-no-export data-no-print>
        <input
          className="input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search invoice, supplier or status…"
        />
        <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">All Types</option>
          <option value="without-tax">Without Tax</option>
          <option value="with-tax">With Tax</option>
        </select>
        <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="posted">Posted</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => { setSearch(""); setTypeFilter("all"); setStatusFilter("all"); }}
        >
          Clear Filters
        </button>
      </div>

      {error && <ErrorBanner message={error} />}
      <div data-report-content>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="navilo-report-title text-base font-bold text-slate-900">Purchase Invoices</h2>
            <p className="text-xs text-slate-500">Showing {filteredRows.length} of {rows.length}</p>
          </div>
          {(search || typeFilter !== "all" || statusFilter !== "all") && (
            <div className="text-xs text-slate-500">
              Active filters: {search ? `Search “${search}” ` : ""}{typeFilter !== "all" ? `• ${typeFilter === "with-tax" ? "With Tax" : "Without Tax"} ` : ""}{statusFilter !== "all" ? `• ${statusFilter}` : ""}
            </div>
          )}
        </div>
        <DataTable columns={columns} rows={filteredRows} loading={loading} emptyMessage="No Main Purchase Invoices found." />
      </div>
    </div>
  );
}
