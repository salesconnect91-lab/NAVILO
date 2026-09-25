import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { PurchaseOrder } from "@/types";
import DataTable, { Column } from "@/components/DataTable";
import { PageHeader, ErrorBanner, StatusBadge, formatCurrency, formatDate } from "@/components/ui";
import { useAuth } from "@/auth/AuthContext";
import { canPerformModule } from "@/auth/permissions";

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
      return matchesSearch && matchesType && matchesStatus;
    });
  }, [rows, search, typeFilter, statusFilter]);

  const visiblePurchaseTotal = useMemo(
    () => filteredRows.reduce((sum, row) => sum + (Number(row.total) || 0), 0),
    [filteredRows],
  );
  const visiblePostedTotal = useMemo(
    () => filteredRows.reduce((sum, row) => String(row.status ?? "").toLowerCase() === "posted" ? sum + (Number(row.total) || 0) : sum, 0),
    [filteredRows],
  );

  const columns: Column<PurchaseOrder>[] = [
    { key: "order_no", label: "Invoice #", render: (r) => <span className="font-medium text-primary-600">{r.order_no}</span> },
    { key: "supplier", label: "Supplier", render: (r) => r.supplier?.name ?? "—" },
    { key: "order_date", label: "Date", render: (r) => formatDate(r.order_date) },
    { key: "invoice_type", label: "Type", render: (r) => r.invoice_type === "Tax Invoice" ? "With Tax" : "Without Tax" },
    { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "total", label: "Total", render: (r) => <span className="font-medium">{formatCurrency(r.total)}</span> },
    { key: "actions", label: "Actions", className: "text-right", render: (r) => {
      const isDraft = String(r.status ?? "").toLowerCase() === "draft";
      return <div className="flex justify-end gap-2">
            )}
            {canCreate && <button onClick={() => navigate("/purchase/new")} className="btn-primary">+ Main Purchase Invoice</button>}
            <span data-navilo-standard-tools-host className="contents" />
          </div>
        )}
      />

      <div className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-[minmax(0,1fr)_180px_180px]" data-no-export data-no-print>
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
          <option value="all">All Posting Statuses</option>
          <option value="draft">Draft</option>
          <option value="posted">Posted</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {error && <ErrorBanner message={error} />}
      <div data-report-content data-navilo-customizable="true" className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="navilo-report-title text-base font-bold text-slate-900">Purchase Invoices</h2>
            {(search || typeFilter !== "all" || statusFilter !== "all") && (
              <p className="text-xs text-slate-500">
                Active filters: {search ? `Search “${search}” ` : ""}{typeFilter !== "all" ? `• ${typeFilter === "with-tax" ? "With Tax" : "Without Tax"} ` : ""}{statusFilter !== "all" ? `• ${statusFilter}` : ""}
              </p>
            )}
          </div>
        </div>

        <div className="mb-3 grid gap-3 md:grid-cols-3" data-no-export>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="text-xs text-slate-500">Visible Invoices</div>
            <div className="mt-2 text-sm font-bold text-slate-900">{filteredRows.length}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="text-xs text-slate-500">Purchase Total</div>
            <div className="mt-2 text-sm font-bold text-slate-900">{formatCurrency(visiblePurchaseTotal)}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="text-xs text-slate-500">Posted Purchase Total</div>
            <div className="mt-2 text-sm font-bold text-slate-900">{formatCurrency(visiblePostedTotal)}</div>
          </div>
        </div>

        <DataTable columns={columns} rows={filteredRows} loading={loading} emptyMessage="No Main Purchase Invoices found." />
      </div>
    </div>
  );
}
